const notice = "This has been taken down due to inactivity from judges, please email hi@techfren.net to contact the creator";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#11110e">
    <title>Conference Ops — Project notice</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #11110e; color: #f4f0e6; padding: 24px; }
      main { width: min(680px, 100%); border: 1px solid #34342c; border-radius: 24px; background: #191914; padding: clamp(32px, 7vw, 64px); box-shadow: 0 28px 80px rgb(0 0 0 / 35%); }
      .mark { display: inline-grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; background: #e5ff75; color: #11110e; font-weight: 800; letter-spacing: -.05em; }
      p { margin: 28px 0 0; font-size: clamp(1.35rem, 4vw, 2.25rem); line-height: 1.25; letter-spacing: -.035em; }
      a { color: #e5ff75; text-decoration-thickness: 2px; text-underline-offset: 5px; }
    </style>
  </head>
  <body>
    <main>
      <span class="mark" aria-hidden="true">CO</span>
      <p>This has been taken down due to inactivity from judges, please email <a href="mailto:hi@techfren.net">hi@techfren.net</a> to contact the creator.</p>
    </main>
  </body>
</html>`;

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
};

export default {
  fetch(request) {
    const { pathname } = new URL(request.url);
    const head = request.method === "HEAD";

    if (pathname === "/robots.txt") {
      return new Response(head ? null : "User-agent: *\nDisallow: /\n", {
        headers: { ...securityHeaders, "content-type": "text/plain; charset=utf-8" },
      });
    }

    const status = pathname === "/" || pathname === "/index.html" ? 200 : 410;
    return new Response(head ? null : html, {
      status,
      headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" },
    });
  },
};

export { notice };
