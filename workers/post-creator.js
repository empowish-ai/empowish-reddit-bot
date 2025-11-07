// workers/post-creator.js

/**
 * Función para obtener un token de acceso de la API de Reddit.
 * Usa el flujo de "password" para aplicaciones tipo "script", que es el más sencillo para bots.
 * @param {object} env - El objeto de entorno de Cloudflare con las variables y secretos.
 * @returns {Promise<string|null>} - El token de acceso o null si hay un error.
 */
async function getRedditAccessToken(env) {
  console.log("Attempting to get Reddit access token...");
  console.log("REDDIT_CLIENT_ID:", env.REDDIT_CLIENT_ID);
  console.log("REDDIT_USERNAME:", env.REDDIT_USERNAME);
  console.log("REDDIT_USER_AGENT:", env.REDDIT_USER_AGENT);
  console.log("REDDIT_CLIENT_SECRET length:", env.REDDIT_CLIENT_SECRET ? env.REDDIT_CLIENT_SECRET.length : 0);
  console.log("REDDIT_PASSWORD length:", env.REDDIT_PASSWORD ? env.REDDIT_PASSWORD.length : 0);
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
    const errorText = await response.text();
    console.error("Error obteniendo token de Reddit:", errorText);
    throw new Error(`Error de la API de Reddit: ${errorText}`);
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
async function postToReddit(title, content, accessToken, flairId, env) {
  let body = `sr=${env.REDDIT_SUBREDDIT}&title=${encodeURIComponent(title)}&kind=self&text=${encodeURIComponent(content)}`;
  
  // Añadimos el flair_id al cuerpo de la petición si se ha proporcionado.
  if (flairId) {
    body += `&flair_id=${flairId}`;
  }

  const response = await fetch(`https://oauth.reddit.com/api/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': env.REDDIT_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Error publicando en Reddit:", errorText);
    throw new Error(`Error de la API de Reddit al publicar: ${errorText}`);
  }
  return await response.json();
}

/**
 * Función para generar contenido usando la API de Gemini.
 * El prompt está diseñado para ser dinámico, usando un pilar y un tipo de post.
 * @param {string} pillar - El pilar fundamental para el contenido.
 * @param {string} postType - El tipo de publicación a generar.
 * @param {object} env - El objeto de entorno de Cloudflare.
 * @returns {Promise<object|null>} - Un objeto con { title, content } o null si hay un error.
 */
async function generateContentWithAI(pillar, postType, env) {
  const prompt = `
  Act as an expert in self-improvement and healing, with an inspiring, empathetic, and practical tone.
  Your task is to create a post for the Reddit community r/Empowish.

  **Fundamental pillar to address:** "${pillar}"
  **Post type:** "${postType}" (e.g., "a deep reflection", "a practical tip", "a question for the community")

  Generate a catchy title and a text that is:
  1.  100% aligned with the mentioned pillar.
  2.  Valuable and actionable for the reader.
  3.  Written in natural and approachable English.

  Strict response format: A JSON object with the keys "title" and "content".
  Example format:
  {
    "title": "This is the title",
    "content": "This is the content of the post."
  }

  Do not include the JSON inside markdown code blocks.
  `;

  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }]
    })
  });

  if (!response.ok) {
    console.error("Error desde Gemini:", await response.text());
    return null;
  }

  const data = await response.json();
  let aiResponseText = data.candidates[0].content.parts[0].text;
  
  try {
    const cleanedResponse = aiResponseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const aiJson = JSON.parse(cleanedResponse);
    
    return {
      title: aiJson.title || "Título generado por IA",
      content: aiJson.content || "Contenido generado por IA"
    };
  } catch (e) {
    console.error("Error al parsear la respuesta JSON de la IA:", e);
    console.error("Respuesta recibida:", aiResponseText);
    return null;
  }
}

/**
 * Este es el objeto principal que exporta Cloudflare Workers.
 */
export default {
  /**
   * Handler para llamadas HTTP (ej: desde nuestro dashboard).
   */
  async fetch(request, env, ctx) {
    if (request.method === 'POST') {
      try {
        const { pillar, postType } = await request.json();

        const pillarsString = await env.EMPOWISH_KV.get('pillars');
        if (!pillarsString) {
          return new Response(JSON.stringify({ success: false, error: "Pillars not found in KV store. Please populate the KV store with the key 'pillars'." }), {
            status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        const pillarList = JSON.parse(pillarsString);
        const pillarData = pillarList.find(p => p.name === pillar);

        if (!pillarData) {
          return new Response(JSON.stringify({ success: false, error: `Pillar '${pillar}' not found.` }), {
            status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        
        const flairId = pillarData.flairId;

        const generatedPost = await generateContentWithAI(pillar, postType, env);
        if (!generatedPost) {
          throw new Error("Fallo al generar contenido con la IA.");
        }

        const accessToken = await getRedditAccessToken(env);
        const result = await postToReddit(generatedPost.title, generatedPost.content, accessToken, flairId, env);

        return new Response(JSON.stringify({ success: true, post: generatedPost, redditResult: result }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message, stack: error.stack }), {
          status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    return new Response("Empowish Bot está activo. Usa una petición POST para publicar.");
  },

  /**
   * Handler para ejecuciones programadas (Cron Triggers).
   */
  async scheduled(event, env, ctx) {
    console.log("Ejecución programada iniciada!");
    
    let pillarList;
    const pillarsString = await env.EMPOWISH_KV.get('pillars');
    if (!pillarsString) {
      console.warn("Pilares no encontrados en KV. Usando lista de pilares hardcodeada. Para producción, guarde los pilares en el KV namespace con la clave 'pillars'.");
      // Temporary hardcoded pillars
      pillarList = [
        {"name":"Self-Awareness & Mindfulness","flairId":"8bea25bc-bb68-11f0-97ba-060e9548cb15"},
        {"name":"Emotional Resilience","flairId":"a6aacd16-bb68-11f0-a529-de2b68f1691b"},
        {"name":"Positive Habits & Discipline","flairId":"bcce3038-bb68-11f0-82a3-f20fd9053f04"},
        {"name":"Healing Relationships","flairId":"e2050430-bb68-11f0-b200-060e9548cb15"},
        {"name":"Purpose & Meaningful Life","flairId":"f6268d1c-bb68-11f0-bc78-f20fd9053f04"}
      ];
    } else {
      pillarList = JSON.parse(pillarsString);
    }
    
    // Elige un objeto de pilar al azar (que ahora contiene nombre y flairId)
    const randomPillarData = pillarList[Math.floor(Math.random() * pillarList.length)];
    const { name: randomPillar, flairId } = randomPillarData;

    const postTypes = ["a deep reflection", "a practical tip", "a question for the community"];
    const randomPostType = postTypes[Math.floor(Math.random() * postTypes.length)];

    console.log(`Pilar elegido: ${randomPillar}. Tipo de post: ${randomPostType}. Flair ID: ${flairId}`);

    const generatedPost = await generateContentWithAI(randomPillar, randomPostType, env);
    if (!generatedPost) {
      console.error("Fallo al generar contenido con la IA durante la ejecución programada.");
      return;
    }

    const accessToken = await getRedditAccessToken(env);
    if (accessToken) {
      try {
        const result = await postToReddit(generatedPost.title, generatedPost.content, accessToken, flairId, env);
        if (result && result.json && result.json.data) {
          console.log("Publicado con éxito en Reddit. URL:", result.json.data.url);
        } else {
          console.error("Respuesta inesperada de Reddit al publicar:", result);
        }
      } catch (error) {
        console.error("Fallo al publicar en Reddit durante la ejecución programada:", error.message);
      }
    } else {
      console.error("Fallo al obtener el token de acceso de Reddit durante la ejecución programada.");
    }
  },
};