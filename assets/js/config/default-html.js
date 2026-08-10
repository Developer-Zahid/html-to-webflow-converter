/**
 * The snippet the editor is seeded with on first load. It is chosen to exercise the tricky
 * paths: inline-style expansion, utility-class passthrough, inline text spacing, SVG internals,
 * skipped empty images, and fallback Custom Elements.
 */
export const DEFAULT_HTML = '';

// `<section class="hero-section main-class text-[14px]" style="padding: 60px 20px; background-color: #f3f4f6; border: 1px solid red; text-align: center;">
//   <h1 class="main-heading text-xl font-bold" style="color: #111827; font-size: 3rem; margin-bottom: 10px;">Hello Webflow CSS!</h1>
//   <p class="subtitle text-grey" style="color: #4b5563; margin-bottom: 20px; line-height: 1.5;">This paragraph has <strong>bold text</strong> and <em>italic emphasis</em>.</p>
//   <ul style="text-align: left; max-width: 300px; margin: 0 auto 20px;">
//     <li>Native List Item 1</li>
//     <li>Native List Item 2</li>
//   </ul>
//   <a href="https://example.com" class="cta-button w-full sm:w-auto" style="background-color: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Learn More</a>

//   <!-- SVG internals are preserved as DOM elements -->
//   <div style="margin: 20px 0; display: flex; justify-content: center;">
//     <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
//       <circle cx="12" cy="12" r="10"></circle>
//       <path d="M12 8v8"></path>
//       <path d="M8 12h8"></path>
//     </svg>
//   </div>

//   <!-- Empty src images are skipped automatically! -->
//   <img src="" alt="Skipped Image" />

//   <!-- Everything else (nav, form, table) converts to custom DOM elements -->
//   <nav class="nav-wrapper p-4 m-2" style="margin-top: 40px; padding: 20px; border: 1px solid #ccc;">
//     <form>
//       <input type="text" placeholder="DOM Element Input" style="padding: 10px;" />
//     </form>
//   </nav>
// </section>`;
