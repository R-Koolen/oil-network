# Data sources

The site republishes the data in `docs/data/`. We use a source only if its terms allow public
republication with nothing more than attribution: no permission request, no registration. The terms below
were read at the source on 2026-10-27, except the Energy Institute's, which were read on 2026-10-09, and Natural Earth's,
which were read on 2026-10-28.

## Required attribution

Show this wherever the data is displayed (for example, in the site footer):

> Crude oil production and petroleum consumption: Source: U.S. Energy Information Administration
> (International Energy Statistics, bulk file updated 19 Oct 2026).
> Refinery capacity and throughput: UNdata, United Nations Energy Statistics Database
> (https://data.un.org/, last updated 15 Dec 2025).
> Trade flows: CEPII, BACI HS12 version 202601 (https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37,
> released 22 Jan 2026), Licence Ouverte / Open Licence 2.0 (Etalab). Gaulier, G. and Zignago, S. (2010),
> BACI: International Trade Database at the Product-Level. The 1994-2007 Version. CEPII Working Paper N°2010-23.

When the data is refreshed, update the dates to those of the new files.

## Used

### U.S. Energy Information Administration (EIA): production and consumption

- Data: International Energy Statistics bulk file, https://api.eia.gov/bulk/INTL.zip (no API key needed).
- Terms: https://www.eia.gov/about/copyrights_reuse.php
  > U.S. government publications are in the public domain and are not subject to copyright protection. You may
  > use and/or distribute any of our data, files, databases, reports, graphs, charts, and other information
  > products that are on our website or that you receive through our email distribution service. However, if you
  > use or reproduce any of our information products, you should use an acknowledgment, which includes the
  > publication date, such as: "Source: U.S. Energy Information Administration (Oct 2008)."
- Republishing allowed: yes. Attribution with the publication date is requested.

### UNdata (United Nations Statistics Division): refining

- Data: Energy Statistics Database, "Crude petroleum - refinery capacity" (trID 131) and "Conventional crude
  oil - transformation in oil refineries" (trID 086), https://data.un.org/Data.aspx?d=EDATA&f=cmID%3aCR
- Terms: https://data.un.org/Host.aspx?Content=UNdataUse
  > All data and metadata provided on UNdata's website are available free of charge and may be copied freely,
  > duplicated and further distributed provided that UNdata is cited as the reference.
- Republishing allowed: yes, citing UNdata.

### CEPII BACI: trade flows

- Data: BACI, HS 2012 nomenclature, version 202601, https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS12_V202601.zip
- Licence: the BACI page lists "Etalab 2.0", linked to https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf
  > The "Grantor" grants the "Reuser" the free, non-exclusive right to "Reuse" the "Information" subject of this
  > licence, for commercial or non-commercial purposes, worldwide and for an unlimited period […]
  > To share, disseminate, redistribute, publish and transmit it. […]
  > Subject to: An acknowledgement of the authorship of the "Information": its source (at least, the name of the
  > "Grantor") and the date of the most recent update of the reused "Information".
- The BACI page also gives a reference to cite (Gaulier and Zignago, 2010, above).
- Republishing allowed: yes, with source and update date.
- BACI is CEPII's reconciliation of UN Comtrade data. We rely on CEPII's own licence statement for it.

### Natural Earth: map shapes

- Data: Natural Earth 4.1.0, Admin 0 countries (1:50m), as TopoJSON in the npm package `world-atlas` 2.0.2 (ISC,
  © Michael Bostock), https://registry.npmjs.org/world-atlas/-/world-atlas-2.0.2.tgz. The package's LICENSE is kept
  in `docs/vendor/LICENSE-world-atlas`.
- Terms: https://www.naturalearthdata.com/about/terms-of-use/
  > All versions of Natural Earth raster + vector map data found on this website are in the public domain. […]
  > No permission is needed to use Natural Earth. Crediting the authors is unnecessary. However, if you wish to cite
  > the map data, simply use one of the following. Short text: Made with Natural Earth.
- Republishing allowed: yes. The site shows "Made with Natural Earth." anyway.
- The country ids in `docs/data/map.json` are ours (ISO3), converted in the pipeline; Natural Earth's names are not
  published.

### UNSD M49 table: code matching only

- https://unstats.un.org/unsd/methodology/m49/overview/ is used only inside the pipeline, to translate UNdata's
  numeric country codes into ISO 3166 alpha-3 codes. Nothing from it is republished: no names, no regions.
  The UN's general copyright page (https://www.un.org/en/about-us/copyright) requires written permission to
  reuse UN material, so we don't republish its names or regions.

## Considered and not used

### Energy Institute, Statistical Review of World Energy: not used

Do not add it back without written permission from the EI, and from S&P Global for the refining data. The person
decided on 2026-10-27 not to ask for that permission.

- Site terms (https://www.energyinst.org/terms, "Copyright"):
  > Copies of documents contained on the Sites may only be made available for information purposes and solely for
  > the private use of the Sites' users. Any use or reproduction of such documents for any other purpose whatsoever
  > is expressly forbidden without the written permission of the EI.
- Statistical Review methodology page (https://www.energyinst.org/statistical-review/about):
  > Using S&P Global data: The redistribution or reproduction of data whose source is S&P Global is strictly
  > prohibited without prior authorization from S&P Global.
  The refinery capacity and throughput sheets say "Source: Includes data from ICIS and S&P Global Energy".
- An older clause allowing quotation with attribution ("Publishers are welcome to quote from this document…") is
  still in the page source, but inside an HTML comment, so it is no longer shown.
- The downloads sit behind a Cloudflare challenge and an email gate, so they can't be fetched by script either.

### JODI Oil World Database: not used

- Terms (https://www.jodidata.org/terms-of-use.aspx, "Intellectual Property"):
  > The Intellectual Property rights in the JODI Website, and in the material published on it, are protected by
  > Intellectual Property laws and treaties around the world. All such rights are reserved.
- The data downloads page (https://www.jodidata.org/oil/database/data-downloads.aspx) states no licence. No open
  licence was found, so JODI does not qualify.
