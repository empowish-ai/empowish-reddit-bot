
## 🚀 Guía de Configuración y Despliegue

Sigue estos pasos para poner tu bot en funcionamiento.

### Prerrequisitos

-   Una cuenta de [Cloudflare](https://cloudflare.com/).
-   Una cuenta de [GitHub](https://github.com/).
-   Una cuenta de [OpenAI](https://platform.openai.com/).
-   Tener [Node.js](https://nodejs.org/) instalado en tu máquina.
-   Ser moderador del subreddit `r/Empowish`.

### Paso 1: Obtener Credenciales de las APIs

1.  **Reddit API:**
    -   Ve a [https://www.reddit.com/prefs/apps](https://www.reddit.com/prefs/apps).
    -   Crea una nueva aplicación tipo **"script"**.
    -   Anota tu **Client ID** y **Client Secret**.

2.  **OpenAI API:**
    -   Ve a [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys).
    -   Crea una nueva clave secreta y cópiala.

### Paso 2: Configurar el Proyecto Localmente

1.  **Clona este repositorio** (o sube los archivos que te proporcioné a uno nuevo).
2.  **Abre una terminal** en la carpeta del proyecto.
3.  **Instala las dependencias:**
    ```bash
    npm install
    ```
4.  **Inicia sesión en Cloudflare** a través de la CLI:
    ```bash
    npx wrangler login
    ```

### Paso 3: Configurar Cloudflare

1.  **Crear Namespace de KV:**
    -   En el dashboard de Cloudflare, ve a **Workers & Pages > KV**.
    -   Crea un nuevo namespace (ej: `empowish-content-namespace`).
    -   Copia su **ID**.

2.  **Añadir Pilares a KV:**
    -   Dentro de tu namespace, crea un nuevo par clave-valor.
    -   **Key:** `pillars`
    -   **Value:** Un array JSON con tus pilares. Ejemplo:
        ```json
        [
          "Autoconocimiento y Mindfulness",
          "Resiliencia Emocional",
          "Hábitos y Disciplina Positiva",
          "Sanación de Relaciones",
          "Propósito y Vida Significativa"
        ]
        ```

3.  **Actualizar `wrangler.toml`:**
    -   Reemplaza `TU_KV_NAMESPACE_ID` con el ID que copiaste.
    -   Cambia `TU_USUARIO_DE_REDDIT` por tu nombre de usuario.

4.  **Configurar Variables de Entorno (Secretos):**
    -   Ve a **Workers & Pages > [Tu Worker] > Settings > Variables**.
    -   Añade las siguientes variables como **"secret"**:
        -   `OPENAI_API_KEY`: Tu clave de OpenAI.
        -   `REDDIT_CLIENT_ID`: Tu Client ID de Reddit.
        -   `REDDIT_CLIENT_SECRET`: Tu Client Secret de Reddit.
        -   `REDDIT_USERNAME`: Tu usuario de Reddit.
        -   `REDDIT_PASSWORD`: Tu contraseña de Reddit.

### Paso 4: Desplegar el Bot

1.  **Desplegar el Worker:**
    ```bash
    npm run deploy
    ```
    -   Anota la URL que Cloudflare te asigna (ej: `https://empowish-post-creator.tu-subdominio.workers.dev`).

2.  **Desplegar el Dashboard (Opcional pero recomendado):**
    -   Conecta tu repositorio de GitHub a **Cloudflare Pages**.
    -   Configúralo para que haga deploy desde la rama `main`.
    -   Una vez desplegado, anota la URL de tu Pages.

3.  **Actualizar la URL en el Dashboard:**
    -   Edita el archivo `public/index.html`.
    -   En la sección `<script>`, reemplaza el placeholder en `const workerUrl` con la URL real de tu Worker.
    -   Haz commit y push de los cambios para que el dashboard se actualice.

### Paso 5: Automatizar con Cron Triggers

1.  En la configuración de tu Worker, ve a la pestaña **"Triggers"**.
2.  En **"Cron Triggers"**, añade una nueva programación.
3.  Usa la sintaxis de cron. Por ejemplo, para publicar los Lunes, Miércoles y Viernes a las 14:00 UTC:
    ```
    0 14 * * 1,3,5
    ```

## 🎯 Cómo Usar el Dashboard Manual

1.  Visita la URL de tu Cloudflare Pages.
2.  Selecciona un **Pilar** y un **Tipo de Post** del menú desplegable.
3.  Haz clic en **"Generar y Publicar en Reddit"**.
4.  Espera un momento y verás el resultado de la operación, incluyendo un enlace a tu nueva publicación en Reddit.

## 🛠️ Personalización

-   **Añadir/Modificar Pilares:** Edita el valor de la clave `pillars` en tu namespace de Cloudflare KV.
-   **Cambiar el "Tono" del Bot:** Modifica el `prompt` dentro de la función `generateContentWithAI` en el archivo `workers/post-creator.js`.
-   **Añadir Nuevos Tipos de Post:** Actualiza la lista `postTypes` en el código del Worker y en el archivo `index.html`.

---