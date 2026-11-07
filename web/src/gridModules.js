// The AG Grid Community modules the two ledger tables use, instead of AllCommunityModule, so the bundle carries only
// these. In development ValidationModule names any module a feature needs and this list lacks.
import {
  ClientSideRowModelModule, ClientSideRowModelApiModule, TextFilterModule, NumberFilterModule, CustomEditorModule, TooltipModule,
  CsvExportModule, ExternalFilterModule, HighlightChangesModule, PinnedRowModule, RowStyleModule, CellStyleModule, ColumnApiModule,
  RowApiModule, ScrollApiModule, RenderApiModule, EventApiModule, ValidationModule,
} from "ag-grid-community";

export const GRID_MODULES = [
  ClientSideRowModelModule, ClientSideRowModelApiModule, TextFilterModule, NumberFilterModule, CustomEditorModule, TooltipModule,
  CsvExportModule, ExternalFilterModule, HighlightChangesModule, PinnedRowModule, RowStyleModule, CellStyleModule, ColumnApiModule,
  RowApiModule, ScrollApiModule, RenderApiModule, EventApiModule,
  ...(import.meta.env?.DEV ? [ValidationModule] : []),
];
