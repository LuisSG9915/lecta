# Lecta MCP

Servidor [MCP](https://modelcontextprotocol.io/) local (stdio) para consultar
Lecta desde un agente de IA. Todas las herramientas son **de solo lectura**:
no guardan palabras, no borran libros y no modifican la cuenta.

Vive en `mcp/` como paquete del workspace y habla con la API HTTP de Lecta
(prod por defecto, o `LECTA_BASE_URL` para apuntar a dev). No se conecta
directamente a la base de datos: reutiliza la sesión y las reglas de la API.

## Herramientas

| Herramienta | Cuenta | Qué hace |
| --- | --- | --- |
| `lookup` | No | Busca una palabra o forma en el catálogo léxico (lema, categoría, zipf, acepciones). |
| `lookup_many` | No | Consulta hasta 200 formas a la vez e informa las que faltan. |
| `catalog` | No | Lista los clásicos del catálogo público con enlaces a EPUB y portada. |
| `catalog_vocab` | No | Manifiesto de vocabulario de un libro: cobertura, bandas zipf y palabras. |
| `whoami` | Sí | Comprueba la sesión y muestra el usuario conectado. |
| `my_books` | Sí | EPUB sincronizados en la nube de la cuenta. |
| `my_words` | Sí | Cuaderno: definiciones, contexto, libro de origen y estado FSRS. Filtra por texto o «vence hoy». |
| `reading_stats` | Sí | Minutos, sesiones, racha, libros en curso, repasos y vocabulario pendiente. |
| `search_annotations` | Sí | Busca en marcadores y pasajes subrayados. |
| `my_knowledge` | Sí | Evidencia «conozco / no conozco» por lema. |
| `health` | No | Comprueba que la API responde y si hay credenciales configuradas. |

Cada cliente antepone el nombre del servidor: en OpenCode, `lookup` aparece
como `lecta_lookup`; en Claude Desktop se muestra bajo el servidor `lecta`.

## Puesta en marcha

Requiere Node 20 o superior.

```sh
pnpm install
pnpm mcp:build       # compila mcp/dist/index.js
pnpm mcp:typecheck   # opcional: tipos del servidor
```

El servidor se ejecuta con `node mcp/dist/index.js` y habla JSON-RPC por
stdio. Los mensajes de estado van a stderr; stdout queda limpio para el
protocolo.

### Credenciales

Sin credenciales funcionan las herramientas públicas. Para las de cuenta,
exporta **una** de estas opciones en el entorno del proceso MCP:

```sh
# Opción A: correo + contraseña (la cuenta debe tener contraseña)
export LECTA_EMAIL="tu@correo"
export LECTA_PASSWORD="…"

# Opción B: cookie de una sesión abierta (sirve también para magic link)
export LECTA_COOKIE="better-auth.session_token=…"
```

La cookie se copia desde el navegador: DevTools → Application → Cookies →
`better-auth.session_token` (en producción puede llamarse
`__Secure-better-auth.session_token`). También se acepta el encabezado
`Cookie:` completo. La sesión caduca: si `whoami` deja de autenticar,
renuébala.

Las credenciales viven solo en memoria del proceso; no se escriben en disco.
`LECTA_EMAIL`/`LECTA_PASSWORD` inician sesión contra
`POST /api/auth/sign-in/email` y reintentan una vez si la cookie vence.

### Variables

| Variable | Default | Uso |
| --- | --- | --- |
| `LECTA_BASE_URL` | `https://lecta.luis-sg9915.workers.dev` | API a consultar. Para dev local: `http://localhost:5173`. |
| `LECTA_COOKIE` | — | Cookie de sesión de Better Auth. |
| `LECTA_EMAIL` | — | Correo para iniciar sesión. |
| `LECTA_PASSWORD` | — | Contraseña para iniciar sesión. |
| `LECTA_TIMEOUT_MS` | `20000` | Timeout por petición (mínimo 1000). |

## Configurar el cliente

### OpenCode (este repo)

`opencode.json` ya registra el servidor y lo recompila al arrancar. Solo
exporta las credenciales antes de abrir OpenCode:

```sh
export LECTA_EMAIL="tu@correo"
export LECTA_PASSWORD="…"
opencode
```

Comprueba la conexión con `opencode mcp list` o `/mcps`. Si OpenCode ya
estaba abierto, reinícialo o reconecta el servidor en `/mcps` para que cargue
el último build.

### Claude Desktop / Cursor / otros clientes stdio

Añade el servidor a la configuración del cliente. Ejemplo para Claude
Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lecta": {
      "command": "node",
      "args": ["/ruta/a/lecta/mcp/dist/index.js"],
      "env": {
        "LECTA_EMAIL": "tu@correo",
        "LECTA_PASSWORD": "…"
      }
    }
  }
}
```

En clientes con interfaz gráfica, el `env` del JSON es la forma fiable de
pasar credenciales: muchas apps de macOS no heredan el entorno del shell.
Ejecuta `pnpm mcp:build` antes de configurar el cliente.

### Codex CLI

Ejemplo en `~/.codex/config.toml`:

```toml
[mcp_servers.lecta]
command = "node"
args = ["/ruta/a/lecta/mcp/dist/index.js"]
env = { LECTA_EMAIL = "tu@correo", LECTA_PASSWORD = "…" }
```

### Inspector

Para probar las herramientas a mano:

```sh
npx @modelcontextprotocol/inspector node mcp/dist/index.js
```

## Desarrollo

```sh
pnpm mcp:build                 # compila a mcp/dist
pnpm mcp:typecheck             # tsc --noEmit
pnpm --filter @lecta/mcp dev   # ejecuta desde TS con tsx (para el inspector)
```

Prueba rápida sin cliente MCP:

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
  | LECTA_EMAIL="…" LECTA_PASSWORD="…" node mcp/dist/index.js
```

La primera línea de stdout debe ser un JSON-RPC válido con
`serverInfo.name = "lecta"`.

## Notas y límites

- **Solo lectura.** No hay herramientas de escritura; el cuaderno y el
  progreso se siguen gestionando desde la app.
- La API pagina las colecciones de usuario a 1000 filas. `reading_stats`
  marca `partial: true` si la ventana supera ese tope; para el uso normal
  (30 días) no se alcanza.
- `catalog_vocab` cachea el manifiesto en memoria 10 minutos (máximo tres
  libros). Los manifiestos son inmutables en R2.
- `my_words` completa definiciones faltantes contra `/api/lexicon/batch`
  sin escribir en la base.
- `reading_stats` agrupa por la zona horaria local del proceso MCP.
