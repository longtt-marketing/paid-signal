// The AG Grid Community modules the two ledger tables use, instead of AllCommunityModule, so the bundle carries only
// these. In development ValidationModule names any module a feature needs and this list lacks.
import {
  ClientSideRowModelModule, ClientSideRowModelApiModule, TextFilterModule, NumberFilterModule, CustomEditorModule, TooltipModule,
  CsvExportModule, ExternalFilterModule, HighlightChangesModule, PinnedRowModule, RowStyleModule, CellStyleModule, ColumnApiModule,
  RowApiModule, ScrollApiModule, RenderApiModule, EventApiModule, GridStateModule, ValidationModule, ModuleRegistry,
} from "ag-grid-community";

export const GRID_MODULES = [
  ClientSideRowModelModule, ClientSideRowModelApiModule, TextFilterModule, NumberFilterModule, CustomEditorModule, TooltipModule,
  CsvExportModule, ExternalFilterModule, HighlightChangesModule, PinnedRowModule, RowStyleModule, CellStyleModule, ColumnApiModule,
  RowApiModule, ScrollApiModule, RenderApiModule, EventApiModule, GridStateModule,
  ...(import.meta.env?.DEV ? [ValidationModule] : []),
];

// AG Grid Enterprise for the Studio ledger: the AI Toolkit (getStructuredSchema, so Claude can return a grid state the
// grid accepts) and row grouping with aggregation. Loaded only when /api/config says it is licensed (or a local dev
// build), so the dashboard stays Community and nothing shows a watermark in production.
export const GRID_ENTERPRISE = "paid-signal:grid-enterprise";
let entPromise = null, entOn = false;
export const gridEnterpriseOn = () => entOn;
export function enableGridEnterprise(license) {
  if (entPromise) return entPromise;
  entPromise = import("ag-grid-enterprise").then(({ LicenseManager, AiToolkitModule, RowGroupingModule }) => {
    if (license) LicenseManager.setLicenseKey(license);
    ModuleRegistry.registerModules([AiToolkitModule, RowGroupingModule]);
    entOn = true;
    dispatchEvent(new Event(GRID_ENTERPRISE));
    return true;
  });
  return entPromise;
}
