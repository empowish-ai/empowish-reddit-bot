// workers/post-creator.js

/**
 * Función para obtener un token de acceso de la API de Reddit.
 * Usa el flujo de "password" para aplicaciones tipo "script", que es el más sencillo para bots.
 * @param {object} env - El objeto de entorno de Cloudflare con las variables y secretos.
 * @returns {Promise<string|null>} - El token de acceso o null si hay un error.
 */
async function getRedditAccessToken(env) {
  // Reddit requiere que las credenciales se envíen codificadas en Base64.
  const credentials = `${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`;
  const encodedCredentials = btoa(credentials);

  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${encodedCredentials}`,
      'User-Agent': env.REDDIT_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    // El cuerpo de la petición contiene el tipo de concesión, usuario y contraseña.
    body: 'grant_type=password&username=' + encodeURIComponent(env.REDDIT_USERNAME) + '&password=' + encodeURIComponent(env.REDDIT_PASSWORD)
  });

  if (!response.ok) {
    console.error("Error obteniendo token de Reddit:", await response.text());
    return null;
  }
  
  const data = await response.json();
  return data.access_token;
}

/**
 * Función para publicar un post de texto (self post) en un subreddit.
 * @param {string} title - El título del post.
 * @param {string} content - El cuerpo del post.
 * @param {string} accessToken - El token de acceso obtenido previamente.
 * @param {object} env - El objeto de entorno de Cloudflare.
 * @returns {Promise<object|null>} - La respuesta de la API de Reddit o null si hay un error.
 */
async function postToReddit(title, content, accessToken, env) {
  const response = await fetch(`https://oauth.reddit.com/api/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': env.REDDIT_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    // El cuerpo es una cadena de consulta (query string) con los datos del post.
    // sr: subreddit, kind: self (post de texto), title: título, text: contenido.
    body: `sr=${env.REDDIT_SUBREDDIT}&title=${encodeURIComponent(title)}&kind=self&text=${encodeURIComponent(content)}`
  });

  if (!response.ok) {
    console.error("Error publicando en Reddit:", await response.text());
    return null;
  }
  return await response.json();
}

/**
 * Función para generar contenido usando la API de OpenAI (GPT).
 * El prompt está diseñado para ser dinámico, usando un pilar y un tipo de post.
 * @param {string} pillar - El pilar fundamental para el contenido.
 * @param {string} postType - El tipo de publicación a generar.
 * @param {object} env - El objeto de entorno de Cloudflare.
 * @returns {Promise<object|null>} - Un objeto con { title, content } o null si hay un error.
 */
async function generateContentWithAI(pillar, postType, env) {
  // Este es el "cerebro" de la IA. Un buen prompt es crucial para obtener buenos resultados.
  const prompt = `
  Actúa como un experto en mejoramiento personal y sanación, con un tono inspirador, empático y práctico.
  Tu tarea es crear una publicación para la comunidad de Reddit r/Empowish.

  **Pilar fundamental a abordar:** "${pillar}"
  **Tipo de publicación:** "${postType}" (ej: "una reflexión profunda", "un consejo práctico", "una pregunta para la comunidad")

  Genera un título llamativo y un texto que sea:
  1.  Alineado 100% con el pilar mencionado.
  2.  Valioso y accionable para el lector.
  3.  Escrito en un español natural y cercano.
  4.  Formato de respuesta estricto:
      - **Título:** [El título aquí]
      - **Contenido:** [El contenido aquí]

  No incluyas ninguna introducción como "Aquí tienes una publicación...". Ve directo al gráfico.
  `;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4-turbo-preview', // Puedes cambiar a 'gpt-3.5-turbo' para reducir costos.
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7, // Un valor entre 0 y 2. Más alto = más creatividad, más bajo = más determinista.
    }),
  });

  if (!response.ok) {
    console.error("Error desde OpenAI:", await response.text());
    return null;
  }

  const data = await response.json();
  const aiResponse = data.choices[0].message.content;
  
  // Usamos expresiones regulares para extraer el título y el contenido de la respuesta de la IA.
  const titleMatch = aiResponse.match(/\*\*Título:\*\*\s*(.*)/);
  const contentMatch = aiResponse.match(/\*\*Contenido:\*\*\s*([\s\S]*)/);

  return {
    title: titleMatch ? titleMatch[1].trim() : "Título generado por IA",
    content: contentMatch ? contentMatch[1].trim() : "Contenido generado por IA"
  };
}


/**
 * Este es el objeto principal que exporta Cloudflare Workers.
 * Contiene dos "handlers": fetch (para llamadas manuales) y scheduled (para automatización).
 */
export default {
  /**
   * Handler para llamadas HTTP (ej: desde nuestro dashboard o una herramienta como Postman).
   * @param {Request} request - El objeto de la petición HTTP.
   * @param {object} env - El objeto de entorno de Cloudflare.
   * @param {object} ctx - El contexto de ejecución.
   * @returns {Promise<Response>} - La respuesta HTTP.
   */
  async fetch(request, env, ctx) {
    // Solo aceptamos peticiones POST para esta acción.
    if (request.method === 'POST') {
      try {
        // Obtenemos los datos del cuerpo de la petición (el pilar y el tipo de post).
        const { pillar, postType } = await request.json();
        
        // Ejecutamos el flujo: generar contenido -> obtener token -> publicar.
        const generatedPost = await generateContentWithAI(pillar, postType, env);
        if (generatedPost) {
          const accessToken = await getRedditAccessToken(env);
          if (accessToken) {
            const result = await postToReddit(generatedPost.title, generatedPost.content, accessToken, env);
            // Devolvemos una respuesta JSON con el éxito y los datos generados.
            return new Response(JSON.stringify({ success: true, post: generatedPost, redditResult: result }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
        // Si algo falla en el flujo, lanzamos un error.
        throw new Error("No se pudo generar o publicar el contenido.");
      } catch (error) {
        // Capturamos cualquier error y devolvemos una respuesta de error 500.
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Si el método no es POST, devolvemos un mensaje simple.
    return new Response("Empowish Bot está activo. Usa una petición POST para iniciar una publicación.");
  },

  /**
   * Handler para ejecuciones programadas (Cron Triggers).
   * Esta función se ejecuta automáticamente según la programación que definas en Cloudflare.
   * @param {object} event - El evento programado.
   * @param {object} env - El objeto de entorno de Cloudflare.
   * @param {object} ctx - El contexto de ejecución.
   */
  async scheduled(event, env, ctx) {
    console.log("Ejecución programada iniciada!");
    
    // 1. Obtener los pilares desde nuestra base de datos KV.
    const pillarsString = await env.EMPOWISH_KV.get('pillars');
    if (!pillarsString) {
      console.error("Pilares no encontrados en KV. Asegúrate de haberlos guardado con la clave 'pillars'.");
      return;
    }
    const pillarList = JSON.parse(pillarsString);
    const randomPillar = pillarList[Math.floor(Math.random() * pillarList.length)];

    // 2. Elegir un tipo de post aleatorio de una lista predefinida.
    const postTypes = ["una reflexión profunda", "un consejo práctico", "una pregunta para la comunidad"];
    const randomPostType = postTypes[Math.floor(Math.random() * postTypes.length)];

    console.log(`Pilar elegido: ${randomPillar}. Tipo de post: ${randomPostType}`);

    // 3. Generar contenido con la IA.
    const generatedPost = await generateContentWithAI(randomPillar, randomPostType, env);
    if (!generatedPost) {
      console.error("Fallo al generar contenido con la IA.");
      return;
    }

    // 4. Publicar en Reddit.
    const accessToken = await getRedditAccessToken(env);
    if (accessToken) {
      const result = await postToReddit(generatedPost.title, generatedPost.content, accessToken, env);
      if (result && result.json && result.json.data) {
        console.log("Publicado con éxito en Reddit. URL:", result.json.data.url);
      } else {
        console.error("Fallo al publicar en Reddit. Respuesta:", result);
      }
    } else {
      console.error("Fallo al obtener el token de acceso de Reddit.");
    }
  },
};