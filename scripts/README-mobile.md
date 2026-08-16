# Mobile layout rules

This app is used on a phone. Two failures kept shipping before they were
written down:

1. **Horizontal page overflow.** Any element extending past the viewport
   makes the whole page pan sideways.
2. **Hidden table content.** A wide table inside `.tbl-scroll` does not
   overflow the page, but it hides columns behind a sideways drag — which is
   where the EV, the stake and the Add button lived on the odds board. At
   390px that table showed 364px of 1065px.

## The rule

At 390px, no page may pan sideways, and no data table may hide content.
The only permitted horizontal scrollers are the score ticker and the edges
strip on Scores, both of which are deliberate swipe affordances.

## How to comply

- Dense tables get `className="tbl responsive"` and a `data-label` on every
  `td`. Under 760px each row becomes a card and each cell a labelled line.
- A cell holding only a button gets `className="action"` for a full-width tap
  target.
- Columns not worth stacking get `className="hide-sm"` on both the `th` and
  the `td`.
- A value and its unit go in one wrapper element, or flex pushes them to
  opposite ends of the row.
