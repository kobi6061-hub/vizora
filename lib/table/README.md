# PROPX · tables — one sorting and filtering standard

`lib/table/core.js` (UMD: `require('../table/core')` on the server, `window.PropxTable` on the page and in ALTARIS,
inlined in the offline build) holds the rules every table follows; `index.html` holds the shared UI (`PT`, `ptHead`,
`ptBar`, `ptOpen`, `ptRows`, `ptDom`).

**Sort.** First click = the column's primary order — numbers, currency and percent high → low; dates newest first;
yes before no; text א → ת / A → Z (locale-aware, Hebrew and English); status in lifecycle order. Second click = the
reverse. Third click = the table's default order (on the default column: default → reverse → default). Missing
values (null, "", "—", NaN, MISSING) always sort last, in both directions — never as 0. Ties keep their order.
A column sorts on the value its cell shows — never a hidden or legacy value: the land column sorts ₪ totals only
(a ₪/m² bid counts as missing there); the projects price column sorts only inside one source; the board sorts the
CBS sales figure it shows (`txShown`), never the research `base.tx`, and only columns whose every value is official
(`rankable`).

**Filter.** Typed, per column: text contains · any of (enum / status) · min..max (number, currency, percent in the
unit shown) · from..to (dates) · yes / no · exact place. A missing value never satisfies an active filter. Filters
intersect; the sort applies to the filtered rows. A column whose filter is already a section facet (city, track,
program, status…) writes that facet — one filter, never two. URL form: `f_<column>=…` on the API;
`<table>.s`, `<table>.p`, `<table>.f.<column>`, `<table>.x.<facet>` in the page URL, mirrored to sessionStorage, so a
drawer, a language switch, a resize or a reload keeps it — and one table never reads another's.

**Full dataset.** Paged tables (land tenders, cities, developers · housing lotteries · developers, projects, market
entries · urban renewal) sort and filter on the server over the whole filtered set (`TC.query`); small tables sort
every row they hold (`ptRows`, `ptDom`). Where a table holds only part of a set it says so: the deals table sorts the
deals loaded (with "load every deal in the period", capped at 3,000); a drawer list capped at 200 states "N of M".

**Controls.** ↕ / ↑ / ↓ beside the label, `aria-sort` on the header, native buttons (Enter / Space), a compact filter
button opening a small dialog (labelled fields, Escape closes, focus returns, Tab stays inside; a bottom sheet under
560 px). Card views on narrow screens get a sort select and a filter button; active filters show as removable chips.

Tests: `test/table.test.js`.
