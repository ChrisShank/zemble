# Zemble (WIP)

> A Zotero plugin for integrating [Semble](https://semble.so), the social knowledge network for researchers.

## Installation

1. Go to the [latest release](https://github.com/ChrisShank/zemble/releases/latest) of the plugin.
2. Click on the `zemble.xpi` file to download it to your computer.
3. In Zotero, click `Tools > Plugins > "..." menu > "Open Plugin from File"` and open the `zemble.xpi` file that you just downloaded.

<video src="https://github.com/user-attachments/assets/6b431fb2-c104-4034-bb7c-6cd0b0ca2e79" width="300" controls></video>

## API Key

By default the plugin is readonly, so columns, sync collection to Zotero, and preview info in item panel. To save items/publish Zotero collection make an API key [here](https://semble.so/settings/api-keys) and paste it into the Zemble settings. You can change this at any time by going to `Preferences -> Zemble`.

## Functionality

- Columns to see how others have interacted with Zotero items. They are all links to the corresponding views in Semble.
  - Added By - how many people has this collection been saved by and have you saved it
    - Clicking on this will save/remove the item to semble.
  - Collections - how many collections has this item been saved to.
  - Connections - how many connections does this item have.
  - Notes - how many notes does this item have.
- Right clicking on items. If multiple items are selected then they will each load in a separate tab.
  - Open items in Semble, if they have a URL or DOI.
- Right click on a collection.
  - Configure Sync - Set the URL to the Semble collection you want to sync the Zotero collection with
  - Save to Semble - Creates a new collection on Semble and saves all of the items in that Zotero Collection to Semble. If done multiple times it will update the same collection with new cards.
  - Sync from Semble - Pull in changes from the Semble collection.
    - Note: this currently does not delete any items that you've added to _your_ local Zotero collection.
- Publish item tags and connections to Semble
  - Enable settings to publish tags and connections from Zotero to Semble

## Contributing

Bugs and feature requests can be filed [here](https://github.com/ChrisShank/zemble/issues). Checkout the [docs](/docs/README.md) for the structure of the repo and how to work with it locally. They are also translated to [chinese](/docs/README-zhCN.md) and [french](/docs/README-frFR.md).
