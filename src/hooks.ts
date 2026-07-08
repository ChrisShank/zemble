import { createSembleClient } from "@semble.so/api";
import { getPref, setPref } from "./utils/prefs";

let client = createSembleClient({
  apiKey: "",
});

function setClient(apiKey: string) {
  cardCache.reset();
  notesCache.reset();
  client = createSembleClient({ apiKey });
}

class FetchCache<Data> {
  #redraw = false;
  #flushing = false;
  #cache = new Map<string, Data | null>();
  #promiseQueue = new Map<string, Promise<Data | null>>();
  #fetcher: (key: string) => Promise<Data>;

  constructor(fetcher: (key: string) => Promise<Data>) {
    this.#fetcher = fetcher;
  }

  get(key: string) {
    if (!key) return undefined;

    const data = this.#cache.get(key);
    // an error fetching data already happened or the data is being fetched
    if (data === null) return undefined;

    // data has not been loaded yet
    if (data !== undefined) return data;

    ztoolkit.log("full cache miss", key);

    this.#cache.set(key, null);
    this.#promiseQueue.set(
      key,
      this.#fetcher(key).catch((e) => {
        ztoolkit.log("Error fetching from cache: ", e.message);
        return null;
      }),
    );

    if (!this.#flushing) {
      this.#flushing = true;
      setTimeout(this.#refresh, 200);
    }

    return undefined;
  }

  set(key: string, data: Data) {
    this.#cache.set(key, data);
    if (!this.#redraw) {
      this.#redraw = true;
      setTimeout(() => {
        this.#redraw = false;
        Zotero.Notifier.trigger("redraw", "itemtree", []);
      }, 0);
    }
  }

  revalidate(key: string) {
    const removed = this.#cache.delete(key);
    // only revalidate if it existed
    if (removed) this.get(key);
  }

  #refresh = async () => {
    const promises = Array.from(this.#promiseQueue.entries()).map(
      ([key, promise]) => promise.then((d) => [key, d] as const),
    );
    // invalidate before waiting so new promises coming in can be fetched
    this.#promiseQueue.clear();
    this.#flushing = false;

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === "fulfilled") {
        this.#cache.set(result.value[0], result.value[1]);
      } else {
        this.#cache.set(result.reason[0], null);
      }
    }

    Zotero.Notifier.trigger("redraw", "itemtree", []);
  };

  reset() {
    this.#cache.clear();
    this.#promiseQueue.clear();
  }
}

let favicon;

const cardCache = new FetchCache(async (url: string) => {
  const [urlMetadata, urlStatus] = await Promise.all([
    client.cards.urlMetadata({ query: { url, includeStats: true } }),
    client.cards.urlLibraryStatus({ query: { url } }),
  ]);

  if (urlStatus.status !== 200)
    throw new Error(`Error fetching card status: ${urlStatus.status}`);
  if (urlMetadata.status !== 200)
    throw new Error(`Error fetching card metadata: ${urlMetadata.status}`);

  return {
    metadata: urlMetadata.body.metadata,
    stats: urlMetadata.body.stats!,
    status: urlStatus.body,
  };
});

const notesCache = new FetchCache((url: string) =>
  client.cards.noteCardsForUrl({ query: { url } }).then((r) => r.body),
);

function batchArr<T>(arr: T[], size: number): T[][] {
  const batch: T[][] = [];
  let i = 0;
  while (i < arr.length) {
    const j = i + size;
    batch.push(arr.slice(i, i + size));
    i = j;
  }
  return batch;
}

const getURLFromItem = (item: Zotero.Item) =>
  item.getField("url") || item.getField("DOI");

async function ensureProfilePrefs() {
  const currentApiKey = getPref("apiKey");

  if (currentApiKey) {
    setClient(currentApiKey);
    return;
  }

  const win = Zotero.getMainWindow() as mozIDOMWindowProxy;
  const prompts = Services.prompt as any;

  if (!currentApiKey) {
    const apiKeyInput = { value: "" };
    const result = prompts.promptPassword(
      win,
      "Zemble API Key",
      "Paste your API key to connect your Semble library, create one here: \n\nhttps://semble.so/settings/api-keys",
      apiKeyInput,
      "",
      { value: false },
    );

    // If cancelled, return
    if (!result) return;

    const newApiKey = apiKeyInput.value.trim();

    if (newApiKey) {
      setPref("apiKey", newApiKey);
      setClient(newApiKey);
    }
  }
}

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // initLocale();
  favicon = `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`;

  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: "Zemble",
    image: favicon,
  });

  ensureProfilePrefs();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;

  ztoolkit.Menu.register("item", {
    tag: "menu",
    label: "Semble",
    icon: favicon,
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
  });

  ztoolkit.Menu.register("collection", {
    tag: "menu",
    label: "Semble",
    icon: favicon,
    children: [
      {
        tag: "menuitem",
        label: "Publish as Semble collection",
        isDisabled: () => {
          const pane = Zotero.getActiveZoteroPane();
          const selectedCollection = pane.getSelectedCollection();
          return !selectedCollection;
        },
        commandListener: async () => {
          const pane = Zotero.getActiveZoteroPane();
          const selectedCollection = pane.getSelectedCollection();

          if (selectedCollection == null) return;

          ztoolkit.log("Selected Collection: ", selectedCollection);

          const items = selectedCollection.getChildItems();

          const urls = items.map(getURLFromItem).filter((url) => url !== "");

          ztoolkit.log("collection urls", urls);

          for (const url of urls) {
            const data = cardCache.get(url);

            if (data === undefined) continue;

            // optimistically update UI in a hacky way
            if (data.status.card === undefined) {
              data.status.card = { urlInLibrary: true } as any;
              data.stats.libraryCount += 1;
            } else if (!data.status.card.urlInLibrary) {
              data.status.card.urlInLibrary = true;
              data.stats.libraryCount += 1;
            }
            cardCache.set(url, data);
          }

          ztoolkit.log("optimistically update saved items");

          const name = `Zotero - ${selectedCollection.name}`;

          const persistedCollections = JSON.parse(
            getPref("collections") || "{}",
          );

          let collectionId = persistedCollections[selectedCollection.id] as
            | string
            | undefined;

          if (collectionId) {
            const r = await client.collections.collectionById({
              query: { collectionId },
            });

            // Collection was deleted
            if (r.status !== 200) {
              ztoolkit.log("Persisted collection does not exist", collectionId);
              collectionId = undefined;
              delete persistedCollections[selectedCollection.id];
              setPref("collections", JSON.stringify(persistedCollections));
            }
          }

          if (!collectionId) {
            ztoolkit.log("create collection");
            const { body } = await client.collections.createCollection({
              body: {
                name,
                description: "Generated from a Zotero collection.",
              },
            });
            collectionId = body.collectionId;
            persistedCollections[selectedCollection.id] = collectionId;
            setPref("collections", JSON.stringify(persistedCollections));
          } else {
            ztoolkit.log("collection already exists", collectionId);
          }

          ztoolkit.log("saving collection to Semble");
          const batchedUrls = batchArr(urls, 2);
          for (const batch of batchedUrls) {
            await Promise.all(
              batch.map((url) =>
                client.cards.addUrlToLibrary({
                  body: {
                    url,
                    collectionIds: [collectionId],
                  },
                }),
              ),
            );
          }
          ztoolkit.log("saved collection to Semble");

          ztoolkit.log("revalidating");
          urls.forEach((url) => cardCache.revalidate(url));
        },
      },
    ],
  });

  Zotero.ItemTreeManager.registerColumn({
    pluginID: addon.data.config.addonID,
    dataKey: "semble-cards",
    label: "Semble Added By",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Added By</span>`,
    dataProvider: getURLFromItem,
    renderCell(index, url = "", column, isFirstColumn, doc) {
      const span = doc.createElement("span");
      span.className = `cell ${column.className} semble`;
      const data = cardCache.get(url);

      if (url === "" || data === undefined) return span;

      const count = data?.stats?.libraryCount || 0;
      const saved = data?.status.card?.urlInLibrary || false;
      const cardId = data?.status.card?.id || "";
      const button = doc.createElement("button");
      button.style.margin = "0 auto";
      button.textContent = saved ? `✓ ${count}` : `+ ${count}`;
      button.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const data = cardCache.get(url)!;

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
        Zotero.Notifier.trigger("redraw", "itemtree", []);
      };

      span.append(button);

      return span;
    },
  });

  Zotero.ItemTreeManager.registerColumn({
    pluginID: addon.data.config.addonID,
    dataKey: "semble-collections",
    label: "Semble Collections",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Collections</span>`,
    dataProvider: getURLFromItem,
    renderCell(index, url = "", column, isFirstColumn, doc) {
      const data = cardCache.get(url);
      const count = data?.stats?.collectionCount;
      const span = doc.createElement("span");
      span.className = `cell ${column.className} semble`;

      if (count !== undefined && count !== 0) {
        const a = doc.createElement("a");
        a.textContent = count.toString();
        a.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          ztoolkit
            .getGlobal("ZoteroPane")
            .loadURI([`https://semble.so/url?id=${url}&sembleTab=collections`]);
        };
        span.appendChild(a);
      }

      return span;
    },
  });

  Zotero.ItemTreeManager.registerColumn({
    pluginID: addon.data.config.addonID,
    dataKey: "semble-connections",
    label: "Semble Connections",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Connections</span>`,
    dataProvider: getURLFromItem,
    renderCell(index, url = "", column, isFirstColumn, doc) {
      const data = cardCache.get(url);
      const count = data?.stats?.connections?.all?.total;
      const span = doc.createElement("span");
      span.className = `cell ${column.className} semble`;

      if (count !== undefined && count !== 0) {
        const a = doc.createElement("a");
        a.textContent = count.toString();
        a.className = `cell ${column.className} semble`;
        a.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          ztoolkit
            .getGlobal("ZoteroPane")
            .loadURI([`https://semble.so/url?id=${url}&sembleTab=connections`]);
        };
        span.appendChild(a);
      }

      return span;
    },
  });

  Zotero.ItemTreeManager.registerColumn({
    pluginID: addon.data.config.addonID,
    dataKey: "semble-notes",
    label: "Semble Notes",
    htmlLabel: `<span><img src="${favicon}" height="10px" width="9px" style="margin-right: 5px;"/>Notes</span>`,
    dataProvider: getURLFromItem,
    renderCell(index, url = "", column, isFirstColumn, doc) {
      const data = notesCache.get(url);
      const count = data?.notes.length;
      const span = doc.createElement("span");
      span.className = `cell ${column.className} semble`;

      if (count !== undefined && count !== 0) {
        const a = doc.createElement("a");
        a.textContent = count.toString();
        a.className = `cell ${column.className} semble`;
        a.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          ztoolkit
            .getGlobal("ZoteroPane")
            .loadURI([`https://semble.so/url?id=${url}&sembleTab=notes`]);
        };
        span.appendChild(span);
      }

      return span;
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
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  ztoolkit.log("pref event", type);

  if (type === "apiKey") {
    setClient(data.value);
    Zotero.Notifier.trigger("refresh", "itemtree", []);
  }
}

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
