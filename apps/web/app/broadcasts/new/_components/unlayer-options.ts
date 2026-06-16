"use client";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
if (!APP_URL) {
  throw new Error(
    "NEXT_PUBLIC_APP_URL is required for the broadcast HTML composer brand-default starter",
  );
}

export const CUSTOM_CSS = `
/* Active tool button — slate-900 */
.blockbuilder-content-tool[aria-selected="true"],
.blockbuilder-content-tool.active,
.actions-container .btn-primary {
  background-color: #0f172a !important;
  border-color: #0f172a !important;
  color: #ffffff !important;
}

/* Hover on tool button — slate-100 */
.blockbuilder-content-tool:hover:not([aria-selected="true"]):not(.active) {
  background-color: #f1f5f9 !important;
}

/* Properties panel accent color — slate-700 (text) */
.property-tools button.active,
.property-tools button[aria-pressed="true"] {
  color: #334155 !important;
}

/* Primary action button (Save / Done if visible) — slate-900 */
.action-bar .btn-primary {
  background-color: #0f172a !important;
  border-color: #0f172a !important;
}
.action-bar .btn-primary:hover {
  background-color: #1e293b !important;
}

/* Drag-target highlight — slate-200 (lighter than Unlayer's default blue) */
.drag-target.drop-zone {
  border-color: #cbd5e1 !important;
  background-color: rgba(241, 245, 249, 0.6) !important;
}
` as const;

export const FOOTER_HTML = `<!-- as-locked-footer-start -->
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;">
<div style="color:#64748b;font-size:12px;line-height:1.6;">
  <a href="#" target="_blank" rel="noreferrer noopener" style="color:#64748b;text-decoration:underline;">Unsubscribe from {{projectName}} emails</a>
  &middot;
  <a href="#" target="_blank" rel="noreferrer noopener" style="color:#64748b;text-decoration:underline;">Unsubscribe from all Adventure Scientists emails</a>
</div>
<div style="color:#64748b;font-size:12px;line-height:1.6;margin-top:8px;">
  Adventure Scientists • 1881 9th St, Suite 201 • Bozeman, MT 59715
</div>
<!-- as-locked-footer-end -->` as const;

export const UNLAYER_OPTIONS = {
  displayMode: "email",
  appearance: {
    theme: "modern_light",
    loader: { html: "" },
    panels: {
      tools: {
        dock: "left",
        collapsible: false,
        tabs: { content: { position: "top" } },
      },
    },
  },
  tools: {
    heading: { enabled: true },
    text: { enabled: true },
    image: { enabled: true, properties: { src: { value: { url: "" } } } },
    button: { enabled: true },
    divider: { enabled: true },
    spacer: { enabled: true },
    columns: { enabled: true },
    menu: { enabled: false },
    social: { enabled: false },
    video: { enabled: false },
    html: { enabled: false },
    timer: { enabled: false },
    form: { enabled: false },
    carousel: { enabled: false },
  },
  fonts: {
    showDefaultFonts: false,
    customFonts: [
      {
        label: "Geist Sans",
        value: "'Geist Sans', system-ui, -apple-system, sans-serif",
        url: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap",
      },
      {
        label: "Source Serif 4",
        value: "'Source Serif 4', Georgia, serif",
        url: "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600&display=swap",
      },
      { label: "Arial", value: "Arial, Helvetica, sans-serif" },
      { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
      { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
      {
        label: "Times New Roman",
        value: "'Times New Roman', Times, serif",
      },
    ],
  },
  mergeTags: {
    firstName: {
      name: "First name",
      value: "{{firstName}}",
      sample: "Alex",
    },
    projectName: {
      name: "Project name",
      value: "{{projectName}}",
      sample: "Forests",
    },
    aliasEmail: {
      name: "Sender alias",
      value: "{{aliasEmail}}",
      sample: "forests@adventurescientists.org",
    },
  },
  features: {
    preview: false,
    preheaderText: false,
    textEditor: { spellChecker: true },
    smartMergeTags: true,
    audit: false,
  },
  safeHtml: true,
  customCSS: CUSTOM_CSS,
  iframe: { title: "Email body editor" },
} as const;

export const BRAND_DEFAULT_STARTER = {
  counters: {
    u_column: 4,
    u_row: 4,
    u_content_text: 2,
    u_content_image: 2,
    u_content_html: 2,
  },
  body: {
    id: "body",
    rows: [
      {
        id: "row-1",
        cells: [1],
        columns: [
          {
            id: "col-1",
            contents: [
              {
                id: "img-1",
                type: "image",
                values: {
                  src: {
                    url: `${APP_URL}/brand/as-mark.png`,
                    width: 512,
                    height: 512,
                  },
                  altText: "Adventure Scientists",
                  textAlign: "center",
                  containerPadding: "16px",
                  size: { autoWidth: false, width: "64px" },
                },
              },
            ],
            values: {
              backgroundColor: "#ffffff",
              padding: "0px",
            },
          },
        ],
        values: {
          backgroundColor: "#ffffff",
          columnsBackgroundColor: "#ffffff",
          padding: "16px 0 0 0",
        },
      },
      {
        id: "row-2",
        cells: [1],
        columns: [
          {
            id: "col-2",
            contents: [
              {
                id: "text-1",
                type: "text",
                values: {
                  text: `<p style="font-family: 'Geist Sans', system-ui, sans-serif; font-size: 16px; line-height: 1.6; color: #334155; margin: 0;">Write your message here…</p>`,
                  containerPadding: "24px 32px",
                  fontFamily: {
                    label: "Geist Sans",
                    value: "'Geist Sans', system-ui, sans-serif",
                  },
                  fontSize: "16px",
                  color: "#334155",
                  textAlign: "left",
                  lineHeight: "160%",
                },
              },
            ],
            values: { backgroundColor: "#ffffff", padding: "0px" },
          },
        ],
        values: {
          backgroundColor: "#ffffff",
          columnsBackgroundColor: "#ffffff",
          padding: "0px",
        },
      },
      {
        id: "row-3",
        cells: [1],
        locked: true,
        columns: [
          {
            id: "col-3",
            contents: [
              {
                id: "footer-html-1",
                type: "html",
                values: {
                  html: FOOTER_HTML,
                  containerPadding: "0px 32px 24px 32px",
                  locked: true,
                },
              },
            ],
            values: { backgroundColor: "#ffffff", padding: "0px" },
          },
        ],
        values: {
          backgroundColor: "#ffffff",
          columnsBackgroundColor: "#ffffff",
          padding: "0px",
        },
      },
    ],
    values: {
      backgroundColor: "#ffffff",
      contentWidth: "600px",
      fontFamily: {
        label: "Geist Sans",
        value: "'Geist Sans', system-ui, sans-serif",
      },
      preheaderText: "",
    },
  },
  schemaVersion: 7,
} as const;
