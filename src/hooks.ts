class FetchCache<Data> {
  cache = new Map<string, Data>();

  flushing = false;
  promiseQueue = new Map<string, Promise<Data>>();
  fetcher: (key: string) => Promise<Data>;

  constructor(fetcher: (key: string) => Promise<Data>) {
    this.fetcher = fetcher;
  }

  get(key: string) {
    const data = this.cache.get(key);
    if (data !== undefined) return data;

    if (!this.promiseQueue.has(key)) {
      this.promiseQueue.set(key, this.fetcher(key));

      if (!this.flushing) {
        this.flushing = true;
        setTimeout(this.refresh, 100);
      }
    }

    return undefined;
  }

  refresh = async () => {
    const promises = Array.from(this.promiseQueue.entries()).map(
      ([key, promise]) => promise.then((d) => [key, d] as const),
    );
    this.promiseQueue.clear();
    this.flushing = false;
    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === "fulfilled") {
        this.cache.set(result.value[0], result.value[1]);
      }
    }

    Zotero.Notifier.trigger("refresh", "itemtree", []);
  };
}

let favicon;
const statCache = new FetchCache((url: string) =>
  fetch(
    `https://api.semble.so/api/cards/metadata?url=${url}&includeStats=true`,
  ).then((r) => r.json() as Record<string, any>),
);

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // initLocale();
  favicon = `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`;

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;

  ztoolkit.Menu.register("item", {
    tag: "menu",
    label: "Open in Semble",
    children: [
      {
        tag: "menuitem",
        label: "Open as URL",
        isDisabled: () => {
          const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
          return items.every((item) => item.getField("url") === "");
        },
        commandListener: () => {
          const pane = ztoolkit.getGlobal("ZoteroPane");
          const selectedItems = pane.getSelectedItems();

          const urls: string[] = [];

          for (const item of selectedItems) {
            const urlString = item.getField("url");

            if (urlString !== "") {
              const url = new URL("https://semble.so/url");
              url.searchParams.set("id", urlString);

              urls.push(url.toString());
            }
          }

          pane.loadURI(urls);
        },
      },
      {
        tag: "menuitem",
        label: "Open as DOI",
        isDisabled: () => {
          const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
          return items.every((item) => item.getField("DOI") === "");
        },
        commandListener: () => {
          const pane = ztoolkit.getGlobal("ZoteroPane");
          const selectedItems = pane.getSelectedItems();

          const urls: string[] = [];

          for (const item of selectedItems) {
            const doi = item.getField("DOI");

            if (doi !== "") {
              const url = new URL("https://semble.so/url");
              url.searchParams.set("id", "https://www.doi.org/" + doi);

              urls.push(url.toString());
            }
          }

          pane.loadURI(urls);
        },
      },
    ],
    icon: favicon,
  });

  await Zotero.ItemTreeManager.registerColumn({
    pluginID: addon.data.config.addonID,
    dataKey: "semble-cards",
    label: "Semble Cards Saved",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Cards Saved</span>`,
    dataProvider: (item: Zotero.Item) => {
      const url = item.getField("url") || item.getField("DOI");
      const data = statCache.get(url);
      const count = data?.stats?.libraryCount;
      return count ?? "-";
    },
  });

  await Zotero.ItemTreeManager.registerColumn({
    pluginID: addon.data.config.addonID,
    dataKey: "semble-collections",
    label: "Semble Collections",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Collections</span>`,
    dataProvider: (item: Zotero.Item) => {
      const url = item.getField("url") || item.getField("DOI");
      const data = statCache.get(url);
      const count = data?.stats?.collectionCount;
      return count ?? "-";
    },
  });

  await Zotero.ItemTreeManager.registerColumn({
    pluginID: addon.data.config.addonID,
    dataKey: "semble-connections",
    label: "Semble Connections",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Connections</span>`,
    dataProvider: (item: Zotero.Item) => {
      const url = item.getField("url") || item.getField("DOI");
      const data = statCache.get(url);
      const count = data?.stats?.connections?.all?.total;
      return count ?? "-";
    },
    // renderCell(index, data = "", column, isFirstColumn, doc) {
    //   const [count, url] = data.split(",");
    //   if (count === undefined || count === "0") {
    //     const span = doc.createElement("span");
    //     span.textContent = "--";
    //     return span;
    //   }
    //   const a = doc.createElement("a");
    //   a.textContent = count;
    //   // a.href = ;
    //   a.onclick = (e) => {
    //     e.preventDefault();
    //     e.stopPropagation();
    //     ztoolkit
    //       .getGlobal("ZoteroPane")
    //       .loadURI([`https://semble.so/url?id=${url}`]);
    //   };
    //   return a;
    // },
  });
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this function clear.
 */
async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  // You can add your code to the corresponding notify type
  ztoolkit.log("notify", event, type, ids, extraData);
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this function clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {}

function onShortcuts(type: string) {}

function onDialogEvents(type: string) {}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
