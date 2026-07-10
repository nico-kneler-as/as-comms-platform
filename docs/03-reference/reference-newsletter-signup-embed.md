# Newsletter Signup Embed

Use this snippet on `adventurescientists.org` to POST a public single-opt-in signup into the app's `/api/newsletter/subscribe` endpoint.

## Before publish

- Set `NEWSLETTER_SIGNUP_ALLOWED_ORIGIN=https://www.adventurescientists.org` in the app environment. This must exactly match the `Origin` the browser sends from the page hosting the form (scheme + host, no path/trailing slash). The site canonicalizes to `www` — the apex `adventurescientists.org` 301-redirects to `www.adventurescientists.org`, so the form always loads on `www` and the origin is the `www` host. It is a single exact-match origin (no wildcard, no list).
- The snippet posts to the production app endpoint `https://as-comms-platform-production.up.railway.app/api/newsletter/subscribe`. Update it if the app moves to a custom domain.
- Keep the hidden `website` field present and empty. It is the honeypot.

## Copyable snippet

```html
<form
  id="as-newsletter-signup"
  action="https://as-comms-platform-production.up.railway.app/api/newsletter/subscribe"
  method="post"
  novalidate
>
  <div>
    <label for="as-newsletter-email">Email</label>
    <input
      id="as-newsletter-email"
      name="email"
      type="email"
      autocomplete="email"
      required
    />
  </div>

  <div>
    <label for="as-newsletter-first-name">First name</label>
    <input
      id="as-newsletter-first-name"
      name="firstName"
      type="text"
      autocomplete="given-name"
    />
  </div>

  <div>
    <label for="as-newsletter-last-name">Last name</label>
    <input
      id="as-newsletter-last-name"
      name="lastName"
      type="text"
      autocomplete="family-name"
    />
  </div>

  <div hidden aria-hidden="true">
    <label for="as-newsletter-website">Website</label>
    <input
      id="as-newsletter-website"
      name="website"
      type="text"
      tabindex="-1"
      autocomplete="off"
    />
  </div>

  <button type="submit">Subscribe</button>
  <p id="as-newsletter-status" role="status" aria-live="polite"></p>
</form>

<script>
  (() => {
    const form = document.getElementById("as-newsletter-signup");
    const status = document.getElementById("as-newsletter-status");

    if (!(form instanceof HTMLFormElement) || !(status instanceof HTMLElement)) {
      return;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "Submitting...";

      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = true;
      }

      const formData = new FormData(form);
      const payload = {
        email: String(formData.get("email") || ""),
        firstName: String(formData.get("firstName") || ""),
        lastName: String(formData.get("lastName") || ""),
        website: String(formData.get("website") || ""),
      };

      try {
        const response = await fetch(form.action, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const result = await response.json();

        if (response.ok && result.ok) {
          form.reset();
          status.textContent = "Thanks for subscribing.";
        } else {
          status.textContent =
            result && typeof result.message === "string"
              ? result.message
              : "We could not process your signup right now.";
        }
      } catch {
        status.textContent = "We could not process your signup right now.";
      } finally {
        if (submitButton instanceof HTMLButtonElement) {
          submitButton.disabled = false;
        }
      }
    });
  })();
</script>
```

## Behavior

- Required field: `email`
- Optional fields: `firstName`, `lastName`
- The API immediately creates or renews a `subscribed` newsletter record with `source = "website_signup"`.
- The welcome email includes a one-click unsubscribe link handled by `/u/[token]`.
