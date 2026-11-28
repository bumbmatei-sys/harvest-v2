# Catalogue card prices and landing photos

The public catalogue directory, item metadata, ministry catalogue list, and
community shelves return `paid`, `priceLabel`, and the structured `price`.
A price contains the current amount in cents, currency, and the original
amount and end time during an active sale. Free items have a null price.
Checkout keeps its existing gate.

A landing's About photo must be a ready, private, regular file from the same
ministry. The photo picker, save operation, public landing, and photo route
use those restrictions. Deleting the file clears the landing's reference.
