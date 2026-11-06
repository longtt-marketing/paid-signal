// Shared form helpers for Paid Signal's custom AG Studio widgets: a section of the widget's own options in the Setup
// tab of Studio's edit panel, and the format shape that lets Studio (and its agents) read and set those options.

/** Adds a section of the widget's own options to the Setup tab of Studio's default form. */
export function withSection(form, section) {
  form?.items?.[0]?.items?.push({ type: "section", ...section });
  return form;
}

const titleShape = (s) => s.object({ enabled: s.boolean().optional(), text: s.string().optional(), textAlign: s.enum(["left", "center", "right"]).optional(), color: s.string().optional() }).optional();

/** The widget's format: Studio's title fields, cross-filter mode, and the widget's own style options. */
export function widgetFormat(style) {
  return ({ api }) => {
    let shape;
    api.defineAiCommand((s) => {
      shape = s.object({ title: titleShape(s), subtitle: titleShape(s), caption: titleShape(s), crossFilter: s.enum(["filter", "highlight", "none"]).optional(), style: style(s).optional() });
      return { input: s.object({}), execute: () => ({ success: true, value: null }) };
    });
    return shape;
  };
}
