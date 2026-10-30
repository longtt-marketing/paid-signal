// Ad names for the demo export, shared by the dashboard and the AG Studio chunk (no Studio import here, so the
// dashboard's first chunk stays small).
export const AD_NAMES = {
  trial_video: "Trial class · video",
  free_guide: "Free guide · lead form",
  parent_carousel: "Testimonial · carousel",
  holiday_static: "Holiday camp · static",
};
export const adName = (k) => AD_NAMES[k] || k;
