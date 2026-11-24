# IngramSpark, other POD services and offset printing for a Canadian self-published children's hardcover (as of 2026-11-24)

Method notes:
- IngramSpark ("IS") help pages returned HTTP 403 to the fetch tool, so I read them through the help centre's public API. The links below are the normal article URLs, and "ed." is the article's last content-edit date. All were live on 2026-11-24.
- USD→CAD conversions use 1.4369, the Bank of Canada rate for 2026-11-23 ([BoC Valet](https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=5)).
- The shared web-search budget ran out partway through, so some items are listed under Gaps.

## 1. IngramSpark hardcover: formats, trims, page counts, colour, unit cost

### Takeaway
A 32-page 8.5x8.5 premium-colour case-laminate hardcover is a standard IS product. It costs **US$9.90 (≈C$14.22) per copy** under the 2026 rate card. At picture-book sizes the only cover is case laminate: no dust jacket and no cloth.

### Cited Findings
- **Cover types:**
  - Case laminate: printed boards with a gloss or matte finish.
  - Jacketed case laminate: the jacket can match the cover or differ from it.
  - Digital Cloth: blue or grey, up to 42 characters of spine text, with or without a jacket.
  - Sources: [IS Help: Print Books trim/bindings, ed. 2026-05-13](https://help.ingramspark.com/hc/en-us/articles/5340963773581-Print-Books-Trim-Sizes-Cover-Bindings-Interior-Papers); [IS Help: Case Laminate & Digital Cloth, ed. 2026-05-13](https://help.ingramspark.com/hc/en-us/articles/35304333693837-Case-Laminate-and-Digital-Cloth-Hard-Cover)
  - Cloth texture is "available only for books printed in the US and UK" — [IS Print Book Options, undated](https://www.ingramspark.com/plan-your-book/print/trim-sizes)
- **Trim size matrix** (File Creation Guide p.40, PDF dated 2026-08-24):
  - Case laminate: 5x8, 5.5x8.5, A5, 6x9, 6.14x9.21, 6.69x9.61, 7x10, 7.5x9.25, **8x8, 8x10, 8x10.88, 8.25x10.75, 8.5x8.5, 8.5x11, 11x8.5**.
  - Jacketed and Digital Cloth: only 5x8, 5.5x8.5, 6x9, 6.14x9.21.
  - **8.25x11 is paperback-only.** There is no 10x8 trim.
  - 11x8.5 is "PREMIUM COLOR ONLY", with a maximum of 400 pages.
  - Source: [IS File Creation Guide](https://www.ingramspark.com/hubfs/downloads/file-creation-guide.pdf)
  - In the matrix image, the 8x8, 8x10, 8.5x8.5 and 8.5x11 case-laminate rows are shaded for Std Color 50#, Std Color 70# and Premium 70#.
- **Custom trims:** case laminate allows widths of 5–8.5" and lengths of 7–11" on white paper; a jacket may not exceed 6.14x9.252" — [IS File Creation Guide p.41](https://www.ingramspark.com/hubfs/downloads/file-creation-guide.pdf). A custom trim needs a new title setup and a new ISBN, and no landscape custom trims are offered — [IS Help: Custom trim, ed. 2026-02-12](https://help.ingramspark.com/hc/en-us/articles/8124581297293-CUSTOM-TRIM-SIZE-AVAILABLE-FOR-PAPERBACK-BOOKS)
- **Hardcover page range:** 18–840 pages for Premium and Std 70#; 18–1,200 for Std 50# — [IS Help: Trim sizes/bindings, ed. 2026-05-13](https://help.ingramspark.com/hc/en-us/articles/5341425168013-Available-Trim-Sizes-Bindings-for-Covers-Interior-Papers-for-Print-Books)
- **Colour tiers:** Standard (50#/74gsm), "Standard 70" (70#/104gsm) and "Premium" (best quality, 70#/104gsm, "ideal for… children's books"). All are inkjet — [same](https://help.ingramspark.com/hc/en-us/articles/5341425168013-Available-Trim-Sizes-Bindings-for-Covers-Interior-Papers-for-Print-Books); [IS Print Book Options](https://www.ingramspark.com/plan-your-book/print/trim-sizes)
- **2026 rate card** (effective 2026-02-01). Formula: per-page cost × pages + per-unit cost. "Large" means wider than 6.15".
  - Large hardcover Premium 70#: **US$6.69 + US$0.1003 per page**.
  - Std 70#: US$6.55 + US$0.0572 per page.
  - Std 50#: US$6.55 + US$0.0427 per page.
  - There is no CAD column (USD, GBP, AUD, EUR only) and no "Large Hardcover w/ Jacket" row.
  - The card also lists "Ultra-Premium Color", including "Large Hardcover (Landscape)" at 18–400 pages, priced at US$7.70 + US$0.1061 per page.
  - Source: [IS Rate Card 2026](https://www.ingramspark.com/hubfs/Rate%20Card_IngramSpark_2026.pdf)
  - In 2025 the Large Premium hardcover cost US$6.49 + US$0.0973 per page — [IS Rate Card 2025, eff. 2025-04-01](https://www.ingramspark.com/hubfs/2025%20Rate%20Card_Spark.pdf)
- **Publisher-direct volume discounts:**
  - 100–299 copies: 2%
  - 300–399: 5%
  - 400–499: 7.5%
  - 500–999: 10%
  - 1,000–1,499: 15%
  - 1,500–2,499: 20%
  - 2,500–4,999: 25%
  - 5,000–9,999: 30%
  - 10,000+: 35%
  - Hardcover economy printing takes 7–10 business days; rush takes 2 days at +30%.
  - Source: [IS Rate Card 2026](https://www.ingramspark.com/hubfs/Rate%20Card_IngramSpark_2026.pdf)
- **Not available at IS:** board books, saddle stitch, spiral binding, spot UV — [IS Help: Print Books trim/bindings](https://help.ingramspark.com/hc/en-us/articles/5340963773581-Print-Books-Trim-Sizes-Cover-Bindings-Interior-Papers)

### Inferences
- Costs below are my arithmetic from the rate card.
  - **32-page 8.5x8.5:** Premium US$9.90 (C$14.22); Std70 US$8.38 (C$12.04); Std50 US$7.92 (C$11.38).
  - **80-page 8.5x11:** Premium US$14.71 (C$21.14); Std70 US$11.13 (C$15.99).
- **Change from 2025:** about +3% (32-page Premium went from US$9.60 to US$9.90).
- **Author copies, 32-page Premium**, before shipping:
  - 500 copies: US$8.91 (C$12.80)
  - 1,000 copies: US$8.41 (C$12.09)
  - 3,000 copies: US$7.42 (C$10.67)

### Gaps
- I could not confirm whether Ultra-Premium is orderable for square hardcovers; no help page covers it.
- I did not use IS's interactive calculators, so the costs are computed from the published rate card.

## 2. IngramSpark fees, discounts, returns, payment terms, CAD pricing

### Takeaway
There is no setup fee, no revision fee (since 2026-02-01) and no membership. IS takes a **1.875% market-access/global distribution fee** on each distributed sale. Your earnings are list − wholesale discount − print − fee, paid 90 days after the end of the month of sale. Returns are optional but can lead to invoices.

### Cited Findings
- **Fees, 2026 rate card:**
  - Title setup is free.
  - The distribution fee is "1.875% of the local list price at the time of sale".
  - File copies cost US$25 per title; a cheque payment costs US$25.
  - An order handling fee applies to direct orders.
  - Annual price increases are capped at 5%.
  - Source: [IS Rate Card 2026](https://www.ingramspark.com/hubfs/Rate%20Card_IngramSpark_2026.pdf)
- "Revisions are FREE. We removed revision fees for all books effective February 1, 2026" — [IS Help: Fee changes, ed. 2026-02-12](https://help.ingramspark.com/hc/en-us/articles/41657495062029-Changes-in-Print-Cost-Market-Access-Fee-and-More)
- **History of the fee:**
  - From 2025-04-01 it was 1.5%, with revisions free for 60 days and US$25 after — [IS Rate Card 2025](https://www.ingramspark.com/hubfs/2025%20Rate%20Card_Spark.pdf).
  - The fee began "effective July 1, 2023" — [IS Help: Distribution, ed. 2026-02-06](https://help.ingramspark.com/hc/en-us/articles/5338716228365-Distribution-of-Print-Books).
  - An older worked example still uses a "1% Global Distribution Fee" — [IS Help: Returns](https://help.ingramspark.com/hc/en-us/articles/5338718331277-Distribution-Returns-Information).
  - Bublish also reports 1.5%→1.875% from 2026-02-01 — [Bublish, undated](https://blog.bublish.com/ingramspark-raising-prices-in-2026).
  - VAT or GST may be added on top of the fee depending on your country — [IS Help: Pricing, ed. 2026-02-06](https://help.ingramspark.com/hc/en-us/articles/5281108644621-Pricing-Your-Book-For-Ingram-s-Global-Distribution-Network)
- **Wholesale discount:**
  - IS recommends 55% and allows a minimum of 40%.
  - Below 53% in the US (which includes Canada), the book is "short discounted" and "many bookstores will not order it."
  - Sources: [IS Help: Pricing](https://help.ingramspark.com/hc/en-us/articles/5281108644621-Pricing-Your-Book-For-Ingram-s-Global-Distribution-Network); [IS Help: Compensation, ed. 2026-02-06](https://help.ingramspark.com/hc/en-us/articles/5338720329229-Compensation-Payments-Payment-Schedule-and-Instructions-for-Updating-Payment-Information)
  - A 40% wholesale discount can leave a bookstore with only 20–25% — [IS Help: Distribution FAQs, 2026-04-28](https://help.ingramspark.com/hc/en-us/articles/45433415095053-Distribution-Compensation-and-Reporting-FAQs)
- **Returns:**
  - **Yes-Deliver** (US/Canada only): wholesale cost + US$3 per book to a US address, or US$20 per book to a non-US address.
  - **Yes-Destroy**: wholesale cost only.
  - **Non-returnable.**
  - Retailers can return any quantity, at any time. If returns exceed earnings, IS invoices you. After switching to non-returnable, there is a 180-day tail.
  - Source: [IS Help: Returns, ed. 2026-03-11](https://help.ingramspark.com/hc/en-us/articles/5338718331277-Distribution-Returns-Information)
- **Payment:**
  - Paid 90 days after the end of the month of sale.
  - CAD ACH to a Canadian bank has a C$25 minimum.
  - The payment currency cannot be changed later.
  - You earn no compensation on your own orders.
  - Source: [IS Help: Compensation](https://help.ingramspark.com/hc/en-us/articles/5338720329229-Compensation-Payments-Payment-Schedule-and-Instructions-for-Updating-Payment-Information)
- **CAD pricing:** "You can add pricing for Canada, however, the compensation earned for books sold in Canada is the same amount as what you earn in the U.S. because we don't have a print facility there." Prices must end in .95, .99 or .00 — [IS Help: Pricing](https://help.ingramspark.com/hc/en-us/articles/5281108644621-Pricing-Your-Book-For-Ingram-s-Global-Distribution-Network)

### Inferences
- The CAD list price sets the Canadian shelf price only. Your earnings follow the US price and discount.
- Yes-Destroy or non-returnable limits a first-timer's risk. IS warns that non-returnable status can hurt online availability.

### Gaps
- I did not find the exact date of the 1%→1.5% change.
- The compensation page lists CAD ACH as a payment method but omits CAD from its list of payment currencies. This is an inconsistency in IS's own article.

## 3. IngramSpark distribution reach, Amazon behaviour, Canadian logistics

### Takeaway
IS feeds Amazon (.com and .ca), Chapters/Indigo, B&N, Walmart.com, Target.com, independent bookstores, schools and libraries. Amazon controls stock, ship-date messages and Prime. Nothing is printed in Canada.

### Cited Findings
- **US & Canada partners** (from the partner image): retailers, libraries, schools, e-commerce, Amazon, Barnes & Noble, independent bookstores, Walmart.com, Target.com, "Chapters / Indigo (Canada)" — [IS Help: US & Canada partners, ed. 2026-02-12](https://help.ingramspark.com/hc/en-us/articles/5350716266893-United-States-and-Canada-POD-Distribution-Partners)
- IS points readers to Bookshop.org, B&N, Books-A-Million and ThriftBooks when Amazon availability is poor — [IS Help: Amazon Listings, ed. 2026-01-05](https://help.ingramspark.com/hc/en-us/articles/42019186273421-Amazon-Listings)
- Most libraries buy from vendors "like Ingram or Baker and Taylor". Professional reviews (SLJ, Kirkus, Booklist) drive their purchases — [IS Help: Library market, ed. 2026-02-12](https://help.ingramspark.com/hc/en-us/articles/5281079853197-Library-Market)
- **Amazon listing behaviour:**
  - Amazon's algorithm decides stocking. "Even print-on-demand books may not show an 'In stock' message," and Prime "is up to them."
  - Amazon may discount overstock below the print cost.
  - IS can report problems to Amazon.com, .ca and .co.uk only after 30 days in distribution.
  - Source: [IS Help: Title listing, ed. 2026-02-12](https://help.ingramspark.com/hc/en-us/articles/5338732266509-Title-Listing-on-Websites)
  - "There is no Amazon opt-out for print books" — [IS Help: Remove Amazon?, ed. 2026-02-26](https://help.ingramspark.com/hc/en-us/articles/43779368615821-Can-I-Remove-Amazon-as-a-Distribution-Channel)
  - A 55% discount and returnable status are "most favorable" — [IS Help: Amazon Optimization, ed. 2026-04-06](https://help.ingramspark.com/hc/en-us/articles/37880632520077-Amazon-Optimization)
- **Timing:** books reach retail sites in 2–6 weeks, or 6–8 weeks for a first title. A revision pulls the title from sale until it is processed — [IS Help: Title listing](https://help.ingramspark.com/hc/en-us/articles/5338732266509-Title-Listing-on-Websites)
- **Print locations:**
  - Three facilities in the US, one in the UK, one in Australia — [IS Help: Where will my order print, ed. 2026-02-12](https://help.ingramspark.com/hc/en-us/articles/34824115160717-Where-Will-My-Order-Print).
  - Canadian retail orders ship "to our Canadian distribution partner from Ingram in the U.S." — [IS Help: Pricing](https://help.ingramspark.com/hc/en-us/articles/5281108644621-Pricing-Your-Book-For-Ingram-s-Global-Distribution-Network)
- **Shipping author copies to Canada:**
  - **Canada Ground:** 3–7 business days after shipment. The quote "include[s] import duties, taxes, brokerage fees, custom fees and document preparation fees."
  - **International/Canada Premium:** 1–5 days. Duties and fees are excluded and invoiced to you afterwards.
  - Source: [IS US Shipping Options PDF, file dated 2021-11-10, attached 2024-06](https://help.ingramspark.com/hc/article_attachments/27523381393421)
  - GST: (print + handling + freight) × 5% for GST registrants; non-registrants also include the declared value — [IS Help: Shipping charges, ed. 2026-02-12](https://help.ingramspark.com/hc/en-us/articles/5337658946445-How-Are-Shipping-Charges-Calculated)
  - A declared unit value is mandatory; for your own stock it equals the print cost — [IS Help: Declared value](https://help.ingramspark.com/hc/en-us/articles/34826688131853-What-is-the-Declared-Unit-Value)

### Inferences
- An Amazon.ca buyer of an IS book gets a US-printed copy that crosses the border. Expect weaker availability messages than for Amazon-held stock.
- Canada Ground is the simpler option for author copies because duties are prepaid in the quote.

### Gaps
- I could not observe real Amazon.ca or Amazon.com ship-date messages for IS hardcovers; the search budget was exhausted.
- No real shipping prices for author copies to Canada (I did not access IS's interactive shipping calculator).
- Unconfirmed whether import duty, as opposed to GST and brokerage, applies to US-printed books entering Canada.

## 4. ISBN strategy (KDP + IngramSpark)

### Takeaway
Use your own ISBNs, one per format. A free KDP ISBN can't be used at IS. The same own ISBN can be live on KDP and IS only if KDP Expanded Distribution is off; KDP hardcovers don't have Expanded Distribution anyway.

### Cited Findings
- KDP: "Free ISBNs from us can only be used on KDP." The imprint then shows as "Independently published". "Each format of your book (paperback vs hardcover) needs its own ISBN" — [KDP: ISBN and Imprint](https://kdp.amazon.com/en_US/help/topic/G201834170)
- IS: you can use both IS and KDP, but "don't select the Expanded Distribution service". "An ISBN can only be listed on one account." Moving from KDP Expanded Distribution to IS requires a title transfer — [IS Help: KDP + IngramSpark, ed. 2026-02-12](https://help.ingramspark.com/hc/en-us/articles/5281126384397-Amazon-Can-I-Set-Up-My-Print-Book-With-KDP-and-IngramSpark)
- To transfer an ISBN you must own it; free IS ISBNs can't be transferred — [IS Help: ISBN use, ed. 2026-02-12](https://help.ingramspark.com/hc/en-us/articles/5281052641037-Proper-ISBN-Use-Title-Transfers). A free IS ISBN must stay in IS distribution, and each format needs its own ISBN — [IS Help: ISBN and EAN, ed. 2026-09-18](https://help.ingramspark.com/hc/en-us/articles/20332045658509-ISBN-and-EAN-Why-You-Need-One-for-Your-Book)
- KDP hardcovers have no Expanded Distribution — [KDP: Distribution rights](https://kdp.amazon.com/en_US/help/topic/G201834280)

### Inferences
- The standard setup is a paperback on KDP with ISBN #1 and a hardcover on IS with ISBN #2.
- A different trim size counts as a different product and needs a separate ISBN.

### Gaps
- I did not open Library and Archives Canada's ISBN page to confirm that Canadian ISBNs are free.

## 5. Alternatives: KDP hardcover, Lulu, BookVault, Blurb, D2D Print; board books

### Takeaway
KDP can't make a 32-page or square hardcover. Lulu can and prints in Canada, but its retail distribution leaves colour casewraps off Amazon. Blurb is costly, and its Amazon channel takes only photo books, on Amazon.com only. D2D Print appears to be paperback-only. I found no on-demand board books.

### Cited Findings
- **KDP hardcover — format and limits:**
  - Case laminate only; "will not have a dust jacket."
  - 75–550 pages.
  - Amazon.ca and Amazon.com.au "aren't listed as primary marketplaces"; the book must be on Amazon.com to reach them.
  - No Expanded Distribution.
  - Source: [KDP: Hardcover](https://kdp.amazon.com/en_US/help/topic/GAVW3FZZAKA2KY3B)
  - Trims: 5.5x8.5, 6x9, 6.14x9.21, 7x10, 8.25x11. Black or premium colour ink only; "Standard color ink is not available for hardcover" — [KDP: Print Options](https://kdp.amazon.com/en_US/help/topic/G201834180)
  - Hardcover proof and author copies can't be ordered through Amazon.ca; use Amazon.com for Canadian delivery — [KDP: Proof/author copies](https://kdp.amazon.com/en_US/help/topic/GVEG4YA9G2T7N6DR)
- **KDP hardcover — cost and royalty:**
  - Amazon.com premium-colour hardcover: US$5.65 + US$0.065 per page at regular trim, US$0.080 per page at large trim (wider than 6.12" or taller than 9"). There is no Amazon.ca row — [KDP: Hardcover Printing Cost](https://kdp.amazon.com/en_US/help/topic/GHT976ZKSKUXBB6H)
  - A search summary quoted US$5.50 + US$0.070 per page (**unverified**, conflicts with the page above).
  - Royalty is 60% at or above US$9.99 or C$13.99, calculated as rate × list − printing. Maximum list price is US$250 / C$350 — [KDP: Hardcover Royalty](https://kdp.amazon.com/en_US/help/topic/G77F3WPD3KQLJTFS)
- **KDP paperback:** custom trims of 4–8.5" × 6–11.69" are allowed. Premium colour runs 24–828 pages (5x8 row) — [KDP: Print Options](https://kdp.amazon.com/en_US/help/topic/G201834180)
- **Lulu — retail distribution eligibility** (eligibility guide, PDF dated 2025-10-02):
  - **8.5x8.5 Square** and **8.5x11 US Letter** are eligible as **casewrap at 24–800 pages**, in B&W, standard colour or premium colour (80# coated).
  - Square sizes cannot have linen with a dust jacket.
  - **Amazon exclusions:** casewrap, colour interiors, 80# paper. **Ingram exclusion:** 60# cream.
  - Network: Amazon, Ingram, Hachette (French only, no hardcovers).
  - One-time US$4.99 publication fee.
  - Creator gets 80% of (list − print − distribution fee). Example: a US$19.99 paperback with US$7.91 print and US$10.00 fees pays US$1.66.
  - Source: [Lulu eligible products PDF](https://assets.lulu.com/media/guides/en/lulu-global-distribution-eligible-products.pdf)
- **Lulu — printing, pricing and direct sales:**
  - Prints in Australia, **Canada**, France, India, the UK and the US. Orders route to the facility nearest the delivery address; you can't choose — [Lulu API help, modified 2026-01-26](https://help.api.lulu.com/en/support/solutions/articles/64000254640-where-are-the-products-produced-and-shipped-from-)
  - Prices are available only through the calculator — [Lulu pricing](https://www.lulu.com/pricing); [Lulu products](https://www.lulu.com/products)
  - Lulu Direct is free and integrates with Shopify, Wix and WooCommerce. You keep 100% of revenue and pay for printing and shipping — [Lulu Sell](https://www.lulu.com/sell)
- **BookVault:**
  - Prints "Paperbacks & hardbacks" from **Winnipeg** on 70gsm cream and 80gsm bond. "Split colour printing isn't available at launch."
  - Production 3–5 working days; Purolator Ground; charged in USD.
  - Integrates with Shopify, Wix, WooCommerce, Payhip and Kickstarter. No retail or Amazon distribution is mentioned.
  - Source: [BookVault Canada post, undated](https://bookvault.app/?p=16000)
  - An older post mentions custom portrait and landscape sizes and US hardcover printing — [BookVault, ~2023, undated](https://bookvault.app/?p=8057)
- **Blurb:**
  - Amazon channel: "photo books (layflat not included)", "*Amazon.com only". Ingram channel: "paperback and hardcover books" — [Blurb Sell & Distribute](https://www.blurb.com/sell-and-distribute)
  - Ingram payments come 90 days after a sale — [Blurb Ingram](https://www.blurb.com/ingram)
  - Prices (USD): hardcover photo book 7x7 US$32.00, 8x10/10x8 US$41.00. 8x10 trade hardcover: Economy Color US$15.99 + US$0.07 per page, Standard Color US$22.99 + US$0.17 per page. No 8x8 or 8.5x8.5 size — [Blurb pricing](https://www.blurb.com/pricing)
- **D2D Print:** the page describes paperbacks only — [D2D Print, © 2026](https://draft2digital.com/print). A 2023 roadmap mention of hardcover appeared only in a search summary (**unverified**).
- **Board books:** IS doesn't offer them — [IS Help](https://help.ingramspark.com/hc/en-us/articles/5340963773581-Print-Books-Trim-Sizes-Cover-Bindings-Interior-Papers). PrintNinja makes offset board books (4–36 pages) with a minimum of 500 copies — [PrintNinja children's](https://printninja.com/printing-products/childrens-book-printing/)

### Inferences
- An 80-page 8.25x11 KDP premium hardcover costs US$12.05 (≈C$17.31), so the minimum list price is about US$20.09.
- A colour hardcover published through Lulu would not reach Amazon through Lulu.

### Gaps
- No Lulu or BookVault unit costs; BookVault's pricing URL returned 404.
- Unconfirmed whether BookVault Winnipeg prints full colour or offers retail distribution.
- Not researched (search budget exhausted): BookBaby, FriesenPress, B&N Press, other board-book printers.

## 6. Offset printing (Canada and overseas)

### Takeaway
China via the broker PrintNinja (prices dated 2026-11-02): a 32-page 8x8 hardcover costs **US$5.39 per copy at 500** and **US$3.42 at 1,000**, excluding freight and duties. Minimum 250 copies; 60–90 days lead time. Friesens (Canada) quotes only on request.

### Cited Findings
- **PrintNinja** (prices "as of November 2, 2026"; case bound, 105 lb matte; excluding shipping, tax and duties):
  - 8x8, 32 pages: US$5.39 at 500 (US$2,694); US$3.42 at 1,000 (US$3,418).
  - 8.5x11, 32 pages: US$5.49 at 500; US$3.56 at 1,000.
  - Printed at a partner facility in China; hardcover minimum 250.
  - Production 3–4 weeks plus 4–6 weeks of ocean freight to the US; 60–90 days in total.
  - Source: [PrintNinja children's](https://printninja.com/printing-products/childrens-book-printing/)
  - The hardcover page says 4–6 weeks of production plus 6–8 weeks by ocean (about 1 week by air), and "free ocean shipping on most orders". Canada is not mentioned — [PrintNinja hardcover](https://printninja.com/printing-products/hardcover-book-printing/)
- **Friesens:** Altona, Manitoba book printer; quotes by request — [Friesens](https://www.friesens.com/). Bindings include "Three Piece Case", sewn and layflat. No children's books, minimums or lead times are stated — [Friesens binding](https://www.friesens.com/books/binding/)

### Inferences
- PrintNinja 8x8 in CAD: C$7.74 at 500 and C$4.91 at 1,000, before freight, duties and GST.
- IS short runs of the 32-page Premium cost US$8.91 at 500 and US$8.41 at 1,000. Offset is about 40–60% cheaper per unit but needs US$2.7k–3.4k up front, plus freight and storage.

### Gaps
- No 3,000-copy prices and no 8.5x8.5 32-page row.
- Marquis's site (JavaScript only) could not be read.
- No Canadian printer prices, no freight from China to Canada, no import duty status, no Canadian minimum runs.

## 7. Selling offset copies on Amazon (FBA, Advantage), Canada and US

### Takeaway
FBA is documented for both Amazon.ca and Amazon.com (referral fee + fulfilment fee + plan fee, with Prime eligibility). Amazon Advantage (consignment, US$99 a year, you receive 45% of list, with a separate Canadian programme) is confirmed only by secondary sources dated 2024–2025.

### Cited Findings
- **Amazon.ca fees (CAD):**
  - Individual C$1.49 per item, or Professional C$29.99 per month.
  - Books referral fee: 15%.
  - FBA standard-size: C$7.40 for 500–600 g, C$7.71 for 600–700 g; items under C$14 are C$0.80 cheaper.
  - Storage: C$40 per m³ (Jan–Sep), C$77 per m³ (Oct–Dec); aged inventory over 180 days costs extra.
  - Source: [sell.amazon.ca/pricing](https://sell.amazon.ca/pricing)
- **Amazon.com fees (USD):**
  - Individual US$0.99 per item, or Professional US$39.99 per month.
  - Media referral 15% plus a "closing fee $1.80 per item" — [sell.amazon.com/pricing](https://sell.amazon.com/pricing)
  - FBA items are "eligible for free, two-day shipping through Prime". New Professional sellers get a US$400 inbound-placement credit. Fee amounts appear only in the calculator — [sell.amazon.com/FBA](https://sell.amazon.com/fulfillment-by-amazon)
- **Advantage:**
  - "$99 per year"; "You receive 45% of the book's retail price"; you are paid after the sale.
  - Separate country programmes, Canada included; "you must apply to each individually."
  - Source: [AuthorImprints, 2024-02-26](https://www.authorimprints.com/10-things-author-publishers-should-know-amazon-advantage-changes/)
  - Also "a consignment program with a $99 annual membership fee" — [Jane Friedman, dated 2020-12-09/2025-04-05](https://janefriedman.com/amazon-advantage-gets-a-makeover-looks-more-like-seller-central/)
  - Amazon's Advantage sites (advantage.amazon.com and advantage.amazon.ca) did not render, so these terms are not confirmed from Amazon.
- **IS print-on-demand listings:** Amazon decides stock and availability; may not show "In stock"; Prime not guaranteed — [IS Help: Title listing](https://help.ingramspark.com/hc/en-us/articles/5338732266509-Title-Listing-on-Websites)

### Inferences
- Example: Amazon.ca FBA at C$26.99, assuming the 500–600 g tier (the weight is my assumption). The 15% referral fee is C$4.05 and FBA is C$7.40, leaving C$15.54. After PrintNinja's 1,000-copy unit cost (C$4.91) that is about C$10.6, before freight, duties, storage and the plan fee.
- An FBA offer shows Amazon shipping and Prime. An IS print-on-demand listing depends on Amazon's ordering. Both can share one ISBN page; this is inferred, not verified.

### Gaps
- No US FBA fee for a hardcover.
- No Amazon.ca closing fee confirmed.
- No official current Advantage terms for Amazon.ca.
- No details on cross-border inbound shipping from Canada into US FBA.

## 8. Side-by-side: Book A (32 pages, 8.5x8.5, colour hardcover) vs Book B (about 80 pages, 8.25x11, colour hardcover)

### Takeaway
For **Book A**, IS is the only print-on-demand route I found that puts the hardcover on Amazon.com and Amazon.ca as well as Indigo and libraries. **Book B** fits KDP hardcover. On IS it needs 8.5x11 or a custom trim. At US$19.99 it loses money almost everywhere.

### Cited Findings
Inputs come from [IS Rate Card 2026](https://www.ingramspark.com/hubfs/Rate%20Card_IngramSpark_2026.pdf), [KDP cost](https://kdp.amazon.com/en_US/help/topic/GHT976ZKSKUXBB6H), [KDP royalty](https://kdp.amazon.com/en_US/help/topic/G77F3WPD3KQLJTFS), [Lulu PDF](https://assets.lulu.com/media/guides/en/lulu-global-distribution-eligible-products.pdf), [Blurb pricing](https://www.blurb.com/pricing), [PrintNinja](https://printninja.com/printing-products/childrens-book-printing/) and [sell.amazon.ca](https://sell.amazon.ca/pricing). The other facts are cited in sections 1–7. Net per sale = list × (1 − discount) − print − 1.875% of list.

| Platform | A: unit cost | B: unit cost | Reach | Net per sale at US$19.99 (CAD 26.99) | Canadian origin | Main limits |
|---|---|---|---|---|---|---|
| IngramSpark | Premium US$9.90 (C$14.22); Std70 US$8.38 | 8.5x11 Premium US$14.71 (C$21.14); Std70 US$11.13 | Amazon.com/.ca, Indigo, B&N, Walmart.com, Target.com, indies, libraries | A Premium −US$1.28 (55% discount) / +US$1.72 (40%). A Std70 +US$0.24 / +US$3.24. B Premium −US$6.09 / −US$3.09. A Canadian sale earns the same as a US sale. | Printed in the US | No jacket or cloth; returns risk; Amazon messaging varies; paid at 90 days |
| KDP hardcover | Not eligible (under 75 pages; no square trim) | 8.25x11 Premium US$12.05 (≈C$17.31) | Amazon.com and EU/UK; Amazon.ca only via .com; no Expanded Distribution | B −US$0.06 (below the ~US$20.09 minimum); +US$2.94 at US$24.99 | Not stated; author copies to Canada via .com | No jacket; no standard colour; 75-page minimum |
| Lulu | 8.5x8.5 casewrap eligible; cost not published | 8.5x11 casewrap; cost not published | Ingram; **Amazon excludes casewrap/colour**; Lulu Direct | 80% × (list − print − fee); US$4.99 one-time | Prints in Canada | Not on Amazon through Lulu |
| BookVault | Not obtained | Not obtained | Own shop and integrations | — | Winnipeg | Colour and retail unclear |
| Blurb | No 8.5x8.5 size (7x7 photo book from US$32) | 8x10 trade HC from US$15.99 + US$0.07/page | Amazon.com (photo books only); Ingram | Negative (inferred) | Not stated | Expensive |
| Offset + FBA | 8x8 32pp US$5.39 at 500 / US$3.42 at 1,000 | 80pp not quoted | Your own channels (FBA, Advantage, direct, stores) | Amazon.ca FBA at C$26.99: about C$15.5 left before unit cost and freight | China; 60–90 days | Cash up front, storage, minimum 250 |

### Inferences
- **Break-even US list price on IS** (55% discount / 40% discount):
  - A Premium: US$22.96 / US$17.03
  - A Std70: US$19.43 / US$14.42
  - B Premium: US$34.12 / US$25.31
- **Recommendation for a Canadian first-timer:**
  - **Book A:** IS case laminate (Premium, or Std70 to save cost), your own ISBN, priced at US$22.99–24.99 or more. Add a CAD price, keeping in mind that earnings follow the US price. Start with Yes-Destroy or non-returnable. Optionally add a KDP paperback with a separate ISBN.
  - Move to offset (China, or a Friesens quote for a Canadian run) plus Amazon.ca FBA only once there is demand for 500 or more copies.
  - **Book B:** a KDP 8.25x11 Premium hardcover at US$24.99 or more is the simplest Amazon route. Add IS 8.5x11 under a separate ISBN for Indigo, bookstores and libraries, or use IS alone with Std70 colour.
  - Lulu and Blurb are weaker for Amazon.

### Gaps
- Lulu and BookVault costs.
- How KDP pays royalties on Amazon.ca hardcover sales.
- Whether an IS custom 8.25x11 case-laminate trim can be distributed.

## 9. Gotchas and open questions

### Takeaway
The main traps: KDP hardcover can't make a 32-page picture book; IS hardcovers lose money at US$19.99 with a 55% discount; Lulu colour casewraps skip Amazon; returns can produce invoices.

### Cited Findings (Gotchas)
- KDP hardcover has a 75-page minimum and no square trim — [KDP: Hardcover](https://kdp.amazon.com/en_US/help/topic/GAVW3FZZAKA2KY3B); [KDP: Print Options](https://kdp.amazon.com/en_US/help/topic/G201834180)
- Amazon.ca is not a primary marketplace for KDP hardcovers. Author copies to Canada must go via .com — [KDP: Distribution rights](https://kdp.amazon.com/en_US/help/topic/G201834280); [KDP: Proof copies](https://kdp.amazon.com/en_US/help/topic/GVEG4YA9G2T7N6DR)
- On IS, jacket and cloth covers come only at small trade trims, and 8.25x11 is paperback-only — [IS File Creation Guide](https://www.ingramspark.com/hubfs/downloads/file-creation-guide.pdf)
- IS print distribution can't opt out of Amazon, and Amazon may discount below the print cost — [IS Help: Remove Amazon?](https://help.ingramspark.com/hc/en-us/articles/43779368615821-Can-I-Remove-Amazon-as-a-Distribution-Channel); [IS Help: Title listing](https://help.ingramspark.com/hc/en-us/articles/5338732266509-Title-Listing-on-Websites)
- Returns have no limit, and switching to non-returnable leaves a 180-day tail — [IS Help: Returns](https://help.ingramspark.com/hc/en-us/articles/5338718331277-Distribution-Returns-Information)
- A CAD price doesn't raise IS earnings, and the payment currency is locked — [IS Help: Pricing](https://help.ingramspark.com/hc/en-us/articles/5281108644621-Pricing-Your-Book-For-Ingram-s-Global-Distribution-Network); [IS Help: Compensation](https://help.ingramspark.com/hc/en-us/articles/5338720329229-Compensation-Payments-Payment-Schedule-and-Instructions-for-Updating-Payment-Information)
- Free KDP or IS ISBNs lock the book to that platform — [KDP ISBN](https://kdp.amazon.com/en_US/help/topic/G201834170); [IS Help: ISBN use](https://help.ingramspark.com/hc/en-us/articles/5281052641037-Proper-ISBN-Use-Title-Transfers)
- Lulu distribution excludes casewrap and colour books from Amazon — [Lulu PDF](https://assets.lulu.com/media/guides/en/lulu-global-distribution-eligible-products.pdf)
- IS Canada Premium shipping bills duties later; Canada Ground includes them — [IS Shipping PDF](https://help.ingramspark.com/hc/article_attachments/27523381393421)

### Inferences
- Price the IS hardcover from its break-even point, not from paperback norms.

### Gaps (open questions / could not verify)
- Live Amazon.ca and Amazon.com ship-date messages for IS hardcovers.
- CAD shipping cost for IS author copies.
- Duty treatment of books printed in the US or China entering Canada.
- Unit costs at Lulu, BookVault, Friesens and Marquis.
- 3,000-copy offset prices and freight from China to Canada.
- Official current Amazon.ca Advantage terms.
- US FBA fee for a hardcover.
- KDP hardcover royalties on Amazon.ca.
- Free Canadian ISBNs from LAC (page not opened).
- Whether IS Ultra-Premium and custom-trim hardcovers can be distributed.
- Any on-demand board-book printer.
