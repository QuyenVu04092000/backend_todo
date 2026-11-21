// Keeps the Render free-tier instance awake.
//
// Render spins a free web service down after 15 minutes without inbound
// HTTP traffic. Pinging our own *public* URL goes back in through Render's
// proxy, so it counts as inbound traffic and the instance never idles.
//
// - On Render, RENDER_EXTERNAL_URL is set automatically, so this turns on by
//   itself and pings `${RENDER_EXTERNAL_URL}/health`.
// - Locally (no RENDER_EXTERNAL_URL) it stays off.
// - KEEP_ALIVE_URL overrides the URL; KEEP_ALIVE=false disables it;
//   KEEP_ALIVE_INTERVAL_MINUTES changes the interval (default 10, max 14).

const DEFAULT_INTERVAL_MINUTES = 10;
const MAX_INTERVAL_MINUTES = 14; // must stay below Render's 15-minute idle timeout
const REQUEST_TIMEOUT_MS = 30_000;

const resolveUrl = () =>
{
  if ( process.env.KEEP_ALIVE_URL ) return process.env.KEEP_ALIVE_URL;
  if ( process.env.RENDER_EXTERNAL_URL )
  {
    return `${ process.env.RENDER_EXTERNAL_URL.replace( /\/+$/, "" ) }/health`;
  }
  return null;
};

const resolveIntervalMs = () =>
{
  const minutes = Number( process.env.KEEP_ALIVE_INTERVAL_MINUTES );
  const safeMinutes =
    Number.isFinite( minutes ) && minutes > 0
      ? Math.min( minutes, MAX_INTERVAL_MINUTES )
      : DEFAULT_INTERVAL_MINUTES;
  return safeMinutes * 60 * 1000;
};

export const startKeepAlive = () =>
{
  if ( process.env.KEEP_ALIVE === "false" ) return null;

  const url = resolveUrl();
  if ( !url || typeof fetch !== "function" ) return null;

  const intervalMs = resolveIntervalMs();

  const ping = async () =>
  {
    try
    {
      const res = await fetch( url, {
        headers: { "User-Agent": "todo-backend-keepalive" },
        signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
      } );
      if ( !res.ok )
      {
        console.warn( `[keep-alive] ${ url } responded ${ res.status }` );
      }
    } catch ( error )
    {
      console.warn( `[keep-alive] ping failed: ${ error?.message ?? error }` );
    }
  };

  const timer = setInterval( ping, intervalMs );
  // Never keep the process alive just for this timer (clean shutdown).
  timer.unref?.();

  console.log(
    `[keep-alive] pinging ${ url } every ${ intervalMs / 60000 } min`,
  );
  return timer;
};
