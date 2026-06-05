import { createSembleClient } from "@semble.so/api";

const client = createSembleClient({
  apiKey: "",
});

class FetchCache<Data> {
  #cache = new Map<string, Data | undefined>();

  #flushing = false;
  #promiseQueue = new Map<string, Promise<Data | undefined>>();
  #fetcher: (key: string) => Promise<Data>;

  constructor(fetcher: (key: string) => Promise<Data>) {
    this.#fetcher = fetcher;
  }

  get(key: string) {
    if (!key) return undefined;

    const data = this.#cache.get(key);
    if (data !== undefined) {
      return data;
    }

    if (!this.#promiseQueue.has(key)) {
      this.#promiseQueue.set(
        key,
        this.#fetcher(key).catch((e) => {
          ztoolkit.log("Error fetching from cache: ", e);
          return undefined;
        }),
      );

      if (!this.#flushing) {
        this.#flushing = true;
        setTimeout(this.#refresh, 100);
      }
    }

    return undefined;
  }

  set(key: string, data: Data) {
    this.#cache.set(key, data);
    Zotero.Notifier.trigger("refresh", "itemtree", []);
  }

  revalidate(key: string) {
    this.#cache.delete(key);
    this.get(key);
  }

  #refresh = async () => {
    const promises = Array.from(this.#promiseQueue.entries()).map(
      ([key, promise]) => promise.then((d) => [key, d] as const),
    );
    this.#promiseQueue.clear();
    this.#flushing = false;
    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === "fulfilled") {
        this.#cache.set(result.value[0], result.value[1]);
      } else {
        this.#cache.set(result.reason[0], undefined);
      }
    }

    Zotero.Notifier.trigger("refresh", "itemtree", []);
  };
}

let favicon;
const cardCache = new FetchCache(async (url: string) => {
  const [{ metadata, stats }, status] = await Promise.all([
    client.cards
      .urlMetadata({ query: { url, includeStats: true } })
      .then((r) => r.body as Required<typeof r.body>),
    client.cards.urlLibraryStatus({ query: { url } }).then((r) => r.body),
  ]);
  return { metadata, stats, status };
});

const notesCache = new FetchCache((url: string) =>
  client.cards.noteCardsForUrl({ query: { url } }).then((r) => r.body),
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
    label: "Semble",
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
    label: "Semble Added By",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Added By</span>`,
    dataProvider: (item: Zotero.Item) => {
      const url = item.getField("url") || item.getField("DOI");
      const data = cardCache.get(url);
      ztoolkit.log(url, data);
      const count = data?.stats?.libraryCount;
      const saved = data?.status.card?.urlInLibrary || false;
      const cardId = data?.status.card?.id;
      return count !== undefined ? `${count},${url},${saved},${cardId}` : "";
    },
    renderCell(index, data = "", column, isFirstColumn, doc) {
      const [count, url, savedString, cardId] = data.split(",");
      const saved = savedString === "true";
      const span = doc.createElement("span");
      span.className = `cell ${column.className} semble`;
      ztoolkit.log("render", count, url, saved);

      if (count === "") return span;

      const button = doc.createElement("button");
      button.style.margin = "0 auto";
      button.textContent = saved ? `✓ ${count}` : `+ ${count}`;
      button.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const data = cardCache.get(url)!;
        ztoolkit.log(data);
        if (saved) {
          client.cards.removeFromLibrary({ body: { cardId } });
          data.stats.libraryCount -= 1;
          if (data.status.card) data.status.card.urlInLibrary = false;
          cardCache.set(url, data);
        } else {
          const addUrlPromise = client.cards.addUrlToLibrary({ body: { url } });
          data.stats.libraryCount += 1;

          // optimistically update UI in a hacky way
          if (data.status.card === undefined) {
            data.status.card = { urlInLibrary: true } as any;
            cardCache.set(url, data);
            await addUrlPromise;
            cardCache.revalidate(url);
          } else {
            data.status.card!.urlInLibrary = true;
            cardCache.set(url, data);
          }
        }
      };

      span.append(button);

      return span;
    },
  });

  await Zotero.ItemTreeManager.registerColumn({
    pluginID: addon.data.config.addonID,
    dataKey: "semble-collections",
    label: "Semble Collections",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Collections</span>`,
    dataProvider: (item: Zotero.Item) => {
      const url = item.getField("url") || item.getField("DOI");
      const data = cardCache.get(url);
      const count = data?.stats?.collectionCount;
      return count ? `${count},${url}` : "";
    },
    renderCell(index, data = "", column, isFirstColumn, doc) {
      const [count, url] = data.split(",");
      const a = doc.createElement("a");

      if (count !== undefined && count !== "0") {
        a.textContent = count;
        a.className = `cell ${column.className} semble`;

        a.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          ztoolkit
            .getGlobal("ZoteroPane")
            .loadURI([`https://semble.so/url?id=${url}&sembleTab=collections`]);
        };
      }

      return a;
    },
  });

  await Zotero.ItemTreeManager.registerColumn({
    pluginID: addon.data.config.addonID,
    dataKey: "semble-connections",
    label: "Semble Connections",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Connections</span>`,
    dataProvider: (item: Zotero.Item) => {
      const url = item.getField("url") || item.getField("DOI");
      const data = cardCache.get(url);
      const count = data?.stats?.connections?.all?.total;
      return count ? `${count},${url}` : "";
    },
    renderCell(index, data = "", column, isFirstColumn, doc) {
      const [count, url] = data.split(",");
      const a = doc.createElement("a");

      if (count !== undefined && count !== "0") {
        a.textContent = count;
        a.className = `cell ${column.className} semble`;
        a.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          ztoolkit
            .getGlobal("ZoteroPane")
            .loadURI([`https://semble.so/url?id=${url}&sembleTab=connections`]);
        };
      }

      return a;
    },
  });

  await Zotero.ItemTreeManager.registerColumn({
    pluginID: addon.data.config.addonID,
    dataKey: "semble-notes",
    label: "Semble Notes",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Notes</span>`,
    dataProvider: (item: Zotero.Item) => {
      const url = item.getField("url") || item.getField("DOI");
      const data = notesCache.get(url);
      const count = data?.notes.length;
      return count ? `${count},${url}` : "";
    },
    renderCell(index, data = "", column, isFirstColumn, doc) {
      const [count, url] = data.split(",");
      const a = doc.createElement("a");

      if (count !== undefined && count !== "0") {
        a.textContent = count;
        a.className = `cell ${column.className} semble`;
        a.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          ztoolkit
            .getGlobal("ZoteroPane")
            .loadURI([`https://semble.so/url?id=${url}&sembleTab=notes`]);
        };
      }

      return a;
    },
  });
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  const doc = win.document;
  const styles = ztoolkit.UI.createElement(doc, "link", {
    properties: {
      type: "text/css",
      rel: "stylesheet",
      href: `chrome://${addon.data.config.addonRef}/content/zemble.css`,
    },
  });
  doc.documentElement?.appendChild(styles);
}

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
  // ztoolkit.log("notify", event, type, ids, extraData);
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
