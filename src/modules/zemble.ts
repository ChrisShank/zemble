import { createSembleClient } from "@semble.so/api";
import { getPref, setPref } from "../utils/prefs";
import PDF, { createItemByZotero, ItemInfo } from "../utils/pdf";
import { initLocale } from "../utils/locale";
import { AtUri } from "@atproto/syntax";
import { config, version } from "../../package.json";

type Collection = Awaited<
  ReturnType<
    ReturnType<typeof createSembleClient>["collections"]["collectionById"]
  >
>["body"];

type CollectionUrlCard = Collection["urlCards"][number];

const ZEMBLE_CLIENT = `${config.addonRef}-${version.replaceAll(".", "_web")}`;

/** Mapping Zotero collection to Semble Collection */
class CollectionMapping {
  static get(collection: Zotero.Collection) {
    const persistedCollections = JSON.parse(getPref("collections") || "{}");

    return persistedCollections[collection.id] as string | undefined;
  }

  static set(collection: Zotero.Collection, id: string) {
    const persistedCollections = JSON.parse(getPref("collections") || "{}");
    persistedCollections[collection.id] = id;
    setPref("collections", JSON.stringify(persistedCollections));
  }

  static delete(collection: Zotero.Collection) {
    const persistedCollections = JSON.parse(getPref("collections") || "{}");
    delete persistedCollections[collection.id];
    setPref("collections", JSON.stringify(persistedCollections));
  }
}

/** Cache fetch requests on they are read, since this is the easiest way to render async data in Zotero. */
class FetchCache<Data> {
  #redraw = false;
  #flushing = false;
  #cache = new Map<string, Data | null>();
  #promiseQueue = new Map<string, Promise<Data | null>>();
  #fetcher: (key: string) => Promise<Data>;

  constructor(fetcher: (key: string) => Promise<Data>) {
    this.#fetcher = fetcher;
  }

  async getAsync(key: string): Promise<Data | undefined> {
    if (!key) return undefined;

    const data = this.#cache.get(key);
    // an error fetching data already happened or the data is being fetched
    if (data === null) return undefined;

    // data has not been loaded yet
    if (data !== undefined) return data;

    ztoolkit.log("full cache miss", key);

    this.#cache.set(key, null);

    const promise = this.#fetcher(key);

    this.#promiseQueue.set(
      key,
      promise.catch((e) => {
        ztoolkit.log("Error fetching from cache: ", e.message);
        return null;
      }),
    );

    if (!this.#flushing) {
      this.#flushing = true;
      setTimeout(this.#refresh, 200);
    }

    return promise;
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

function getURLFromItem(item: Zotero.Item) {
  const url = item.getField("url");

  if (url) return url;

  let doi = item.getField("DOI");

  if (!doi) return "";

  if (!doi.startsWith("https")) {
    doi = `https://doi.org/${doi}`;
  }
  return doi;
}

function getTextForSaveButton(saved: boolean, count: number) {
  return saved ? `✓ ${count}` : `+ ${count}`;
}

type InferCardCache<T> = T extends FetchCache<infer T> ? T : never;

type SembleCard = InferCardCache<typeof Zemble.cardCache>;

export class Zemble {
  static favicons: Record<string, string> = {};

  static client: ReturnType<typeof createSembleClient> = createSembleClient({
    client: ZEMBLE_CLIENT,
  });

  static cardCache = new FetchCache(async (url: string) => {
    const [urlMetadata, urlStatus] = await Promise.all([
      this.client.cards.urlMetadata({ query: { url, includeStats: true } }),
      this.client.cards.urlLibraryStatus({ query: { url } }),
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

  static notesCache = new FetchCache((url: string) =>
    this.client.cards.noteCardsForUrl({ query: { url } }).then((r) => r.body),
  );

  static init() {
    initLocale();

    this.favicons["16"] =
      `chrome://${addon.data.config.addonRef}/content/icons/favicon-16.png`;
    this.favicons["20"] =
      `chrome://${addon.data.config.addonRef}/content/icons/favicon-20.png`;
    this.favicons["64"] =
      `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`;

    const currentApiKey = getPref("apiKey");

    if (currentApiKey) {
      Zemble.setAPIKey(currentApiKey);
      return;
    }
  }

  static setAPIKey(apiKey: string) {
    this.cardCache.reset();
    this.notesCache.reset();
    this.client = createSembleClient({ apiKey, client: ZEMBLE_CLIENT });
  }

  static registerPreferences() {
    Zotero.PreferencePanes.register({
      pluginID: addon.data.config.addonID,
      src: rootURI + "content/preferences.xhtml",
      label: "Zemble",
      image: this.favicons["64"],
    });
  }

  static registerItemMenu() {
    ztoolkit.Menu.register("item", {
      tag: "menu",
      label: "Semble",
      icon: this.favicons["64"],
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
        {
          tag: "menuitem",
          label: "Save item(s)",
          isDisabled: () => {
            const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
            return items.every((item) => !getURLFromItem(item));
          },
          commandListener: async () => {
            const pane = ztoolkit.getGlobal("ZoteroPane");
            const selectedItems = pane.getSelectedItems();

            for (const item of selectedItems) {
              await this.addCardToSemble(item, []);
            }
          },
        },
      ],
    });
  }

  static registerCollectionMenu() {
    const promptSembleCollection = async (
      collection: Zotero.Collection,
      value = "",
    ) => {
      const input = { value };
      const result = Services.prompt.prompt(
        Zotero.getMainWindow() as mozIDOMWindowProxy,
        "Semble Collection Sync",
        `The URL of the Semble collection you would like to sync with the '${collection.name}' Zotero collection.`,
        input,
        "",
        { value: false },
      );

      // Prompt was cancelled!
      if (!result) return value;

      const re = /https:\/\/semble.so\/profile\/(.*)\/collections\/(.*)/;
      const match = re.exec(input.value);

      if (match === null) {
        return value;
      }
      const { status, body } = await this.client.collections.collectionByAtUri({
        query: { handle: match[1], recordKey: match[2] },
      });

      if (status !== 200) {
        return value;
      }

      CollectionMapping.set(collection, body.id);
      return value;
    };

    const saveItem = async (
      card: CollectionUrlCard,
      selectedCollection: Zotero.Collection,
      pane: _ZoteroTypes.ZoteroPane,
    ) => {
      const {
        doi: DOI,
        isbn: ISBN,
        title = card.url,
        siteName,
        publishedDate,
        author,
        retrievedAt,
      } = card.cardContent;

      const doiUrl = "https://doi.org/";
      const parsedDOI = card.url.startsWith(doiUrl)
        ? card.url.replace(doiUrl, "")
        : undefined;

      let item: Zotero.Item;
      const itemType = Zotero.ItemTypes.getID("webpage");

      if (DOI || ISBN || parsedDOI) {
        try {
          item = await createItemByZotero({ DOI: DOI || parsedDOI }, [
            selectedCollection.id,
          ]);
          // sometimes the url will resolve to a different URL
          item.setField("url", card.url);
          ztoolkit.log("loaded from DOI", card.url, DOI);
        } catch (e) {
          ztoolkit.log("error saving item", e);
          const data: Partial<Record<_ZoteroTypes.Item.ItemField, string>> = {
            title: title || siteName,
            url: card.url,
            accessDate: retrievedAt || "CURRENT_TIMESTAMP",
            date: publishedDate || "",
          };
          item = await pane.newItem(itemType, data, null, true);
        }
      } else {
        const data: Partial<Record<_ZoteroTypes.Item.ItemField, string>> = {
          title: title || siteName,
          url: card.url,
          accessDate: retrievedAt || "CURRENT_TIMESTAMP",
          date: publishedDate || "",
        };
        item = await pane.newItem(itemType, data, null, true);
      }

      if (item) {
        item.setField("extra", `Semble user: ${card.author.id}`);
      }
    };

    ztoolkit.Menu.register("collection", {
      tag: "menu",
      label: "Semble",
      icon: this.favicons["64"],
      children: [
        {
          tag: "menuitem",
          label: "Configure Sync",
          isDisabled: () => {
            const pane = Zotero.getActiveZoteroPane();
            const selectedCollection = pane.getSelectedCollection();
            return !selectedCollection;
          },
          commandListener: async () => {
            const pane = Zotero.getActiveZoteroPane();
            const selectedCollection = pane.getSelectedCollection();
            if (!selectedCollection) return;

            let collectionId = CollectionMapping.get(selectedCollection);
            let value;

            if (collectionId) {
              const { status, body } =
                await this.client.collections.collectionById({
                  query: { collectionId },
                });

              // Collection was deleted
              if (status !== 200) {
                ztoolkit.log(
                  "Persisted collection does not exist",
                  collectionId,
                );
                collectionId = undefined;
                CollectionMapping.delete(selectedCollection);
              } else if (body.uri) {
                const atURI = new AtUri(body.uri);
                value = `https://semble.so/profile/${body.author.handle}/collections/${atURI.rkey}`;
              }
            }
            ztoolkit.log("collection URL", value);

            await promptSembleCollection(selectedCollection, value);
          },
        },
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

            for (const url of urls) {
              const data = this.cardCache.get(url);

              if (data === undefined) continue;

              // optimistically update UI in a hacky way
              if (data.status.card === undefined) {
                data.status.card = { urlInLibrary: true } as any;
                data.stats.libraryCount += 1;
              } else if (!data.status.card.urlInLibrary) {
                data.status.card.urlInLibrary = true;
                data.stats.libraryCount += 1;
              }
              this.cardCache.set(url, data);
            }

            const progress = new ztoolkit.ProgressWindow(
              addon.data.config.addonName,
              {
                closeOnClick: false,
                closeOtherProgressWindows: true,
              },
            )
              .createLine({
                type: "default",
                text: `Publishing Zotero collection '${selectedCollection.name}' to Semble.`,
                progress: 0,
              })
              .show();

            ztoolkit.log("optimistically update saved items");

            const name = `Zotero - ${selectedCollection.name}`;

            let collectionId = CollectionMapping.get(selectedCollection);

            if (collectionId) {
              const r = await this.client.collections.collectionById({
                query: { collectionId },
              });

              // Collection was deleted
              if (r.status !== 200) {
                ztoolkit.log(
                  "Persisted collection does not exist",
                  collectionId,
                );
                collectionId = undefined;
                CollectionMapping.delete(selectedCollection);
              }
            }

            if (!collectionId) {
              ztoolkit.log("create collection");
              const { body } = await this.client.collections.createCollection({
                body: {
                  name,
                  description: "Generated from a Zotero collection.",
                },
              });
              collectionId = body.collectionId;
              CollectionMapping.set(selectedCollection, collectionId);
            } else {
              ztoolkit.log("collection already exists", collectionId);
            }

            ztoolkit.log("saving collection to Semble");

            const itemsWithURLs = items.filter((item) => {
              const url = getURLFromItem(item);
              const extra = item.getField("extra");
              const createdByZemble =
                extra && extra.includes("Semble user: did:");
              return url && !createdByZemble;
            });

            ztoolkit.log("items to save", items.length, itemsWithURLs.length);

            let count = 0;
            const batchedUrls = batchArr(itemsWithURLs, 2);
            for (const batch of batchedUrls) {
              try {
                await Promise.all(
                  batch.map((item) =>
                    this.addCardToSemble(item, [collectionId], false),
                  ),
                );
                count += 1;
                progress.changeLine({
                  progress: (count / batchedUrls.length) * 100,
                });
                ztoolkit.log("progress", (count / batchedUrls.length) * 100);
              } catch (e) {
                ztoolkit.log("error publishing collection", e);
              }
            }

            ztoolkit.log("saved collection to Semble");

            ztoolkit.log("revalidating");

            urls.forEach((url) => this.cardCache.revalidate(url));

            progress.close();
          },
        },
        {
          tag: "menuitem",
          label: "Sync from Semble collection",
          isDisabled: () => {
            const pane = Zotero.getActiveZoteroPane();
            const selectedCollection = pane.getSelectedCollection();
            if (!selectedCollection) return true;
            const sembleCollectionId =
              CollectionMapping.get(selectedCollection);
            return sembleCollectionId === undefined;
          },
          commandListener: async () => {
            const pane = Zotero.getActiveZoteroPane();
            const selectedCollection = pane.getSelectedCollection();

            if (selectedCollection == null) return;

            ztoolkit.log("Selected Collection: ", selectedCollection);

            const items = selectedCollection.getChildItems();

            const urlToItemsMap = new Map(
              items.map((i) => [getURLFromItem(i), i]),
            );

            const collectionId = CollectionMapping.get(selectedCollection);

            if (collectionId === undefined) return;

            const progress = new ztoolkit.ProgressWindow(
              addon.data.config.addonName,
              {
                closeOnClick: false,
                closeOtherProgressWindows: true,
              },
            )
              .createLine({
                type: "default",
                text: `Syncing Zotero collection '${selectedCollection.name}' from Semble collection.`,
              })
              .show();

            let page: number | undefined = undefined;
            let hasMore = true;
            do {
              ztoolkit.log("fetching page", page || 1);
              const { status, body } =
                await this.client.collections.collectionById({
                  query: { collectionId, page, limit: 50 },
                });

              if (status !== 200) {
                ztoolkit.log("Error fetching collection to publish");
                progress.changeLine({
                  type: "error",
                  text: "Error publishing to Semble collection. Check if you have permission to add to cards to it. ",
                });
                return;
              }
              page = body.pagination.currentPage + 1;
              hasMore = body.pagination.hasMore;

              ztoolkit.log(body.urlCards);

              const promises = body.urlCards.map((card) => {
                const item = urlToItemsMap.get(card.url);

                if (item !== undefined) return Promise.resolve();

                return saveItem(card, selectedCollection, pane);
              });

              await Promise.allSettled(promises);
            } while (hasMore);

            progress.changeLine({
              type: "success",
            });
          },
        },
      ],
    });
  }

  static registerItemColumns() {
    Zotero.ItemTreeManager.registerColumn({
      pluginID: addon.data.config.addonID,
      dataKey: "semble-cards",
      label: "Semble Added By",
      htmlLabel: `<span><img src="${this.favicons["64"]}" height="10px" width="9px" style="margin-right: 5px;"/>Added By</span>`,
      dataProvider: (item) => item.id.toString(),
      renderCell: (index, itemId = "", column, isFirstColumn, doc) => {
        const item = Zotero.Items.get(itemId);
        const url = getURLFromItem(item);
        const span = doc.createElement("span");
        span.className = `cell ${column.className} semble`;
        const data = this.cardCache.get(url);

        if (url === "" || data === undefined) return span;

        const count = data?.stats?.libraryCount || 0;
        const saved = data?.status.card?.urlInLibrary || false;
        const cardId = data?.status.card?.id || "";
        const button = doc.createElement("button");
        button.style.margin = "0 auto";
        button.textContent = getTextForSaveButton(saved, count);
        button.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const data = this.cardCache.get(url)!;

          if (saved) {
            this.client.cards.removeFromLibrary({ body: { cardId } });
            data.stats.libraryCount -= 1;
            if (data.status.card) data.status.card.urlInLibrary = false;
            this.cardCache.set(url, data);
          } else {
            const addUrlPromise = this.addCardToSemble(item);
            data.stats.libraryCount += 1;

            // optimistically update UI in a hacky way
            if (data.status.card === undefined) {
              data.status.card = { urlInLibrary: true } as any;
              this.cardCache.set(url, data);
              await addUrlPromise;
              this.cardCache.revalidate(url);
            } else {
              data.status.card!.urlInLibrary = true;
              this.cardCache.set(url, data);
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
      htmlLabel: `<span><img src="${this.favicons["64"]}" height="10px" width="9px" style="margin-right: 5px;"/>Collections</span>`,
      dataProvider: getURLFromItem,
      renderCell: (index, url = "", column, isFirstColumn, doc) => {
        const data = this.cardCache.get(url);
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
              .loadURI([
                `https://semble.so/url?id=${url}&sembleTab=collections`,
              ]);
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
      htmlLabel: `<span><img src="${this.favicons["64"]}" height="10px" width="9px" style="margin-right: 5px;"/>Connections</span>`,
      dataProvider: getURLFromItem,
      renderCell: (index, url = "", column, isFirstColumn, doc) => {
        const data = this.cardCache.get(url);
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
              .loadURI([
                `https://semble.so/url?id=${url}&sembleTab=connections`,
              ]);
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
      htmlLabel: `<span><img src="${this.favicons["64"]}" height="10px" width="9px" style="margin-right: 5px;"/>Notes</span>`,
      dataProvider: getURLFromItem,
      renderCell: (index, url = "", column, isFirstColumn, doc) => {
        const data = this.notesCache.get(url);
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

  static registerItemPanel() {
    const createRow = (doc: Document, data: SembleCard) => {
      const url = data.metadata.url;
      const cardId = data?.status.card?.id || "";
      const count = data.stats.libraryCount;
      const saved = data.status.card?.urlInLibrary || false;

      return ztoolkit.UI.createElement(doc, "div", {
        namespace: "xul",
        children: [
          {
            tag: "div",
            properties: {
              textContent: data.metadata.title || "[No Title]",
            },
          },
          {
            tag: "button",
            styles: {
              margin: "0 auto",
            },
            properties: {
              textContent: getTextForSaveButton(saved, count),
            },
            listeners: [
              {
                type: "click",
                listener: async (e) => {
                  if (saved) {
                    this.client.cards.removeFromLibrary({ body: { cardId } });
                    data.stats.libraryCount -= 1;
                    if (data.status.card) data.status.card.urlInLibrary = false;
                    this.cardCache.set(data.metadata.url, data);
                    (e.target as HTMLElement).textContent =
                      getTextForSaveButton(false, count);
                  } else {
                    const addUrlPromise = this.client.cards.addUrlToLibrary({
                      body: { url },
                    });
                    data.stats.libraryCount += 1;
                    (e.target as HTMLElement).textContent =
                      getTextForSaveButton(true, count);

                    // optimistically update UI in a hacky way
                    if (data.status.card === undefined) {
                      data.status.card = { urlInLibrary: true } as any;
                      this.cardCache.set(url, data);
                      await addUrlPromise;
                      this.cardCache.revalidate(url);
                    } else {
                      data.status.card!.urlInLibrary = true;
                      this.cardCache.set(url, data);
                    }
                  }
                  Zotero.Notifier.trigger("redraw", "itemtree", []);
                },
              },
            ],
          },
        ],
      });
    };

    Zotero.ItemPaneManager.registerSection({
      paneID: "zemble-references",
      pluginID: addon.data.config.addonID,
      bodyXHTML: `
  <linkset>
    <html:link
      rel="stylesheet"
      href="chrome://${addon.data.config.addonRef}/content/panel.css"
    ></html:link>
    <html:link
      rel="localization"
      href="${addon.data.config.addonRef}-panel.ftl"
    ></html:link>
  </linkset>`,
      header: {
        icon: this.favicons["16"],
        l10nID: `${addon.data.config.addonRef}-header`,
        l10nArgs: '{"count": "0"}',
      },
      sidenav: {
        icon: this.favicons["20"],
        l10nID: `${addon.data.config.addonRef}-sidenav`,
      },
      onInit: (props) => {
        ztoolkit.log("section init", props);
      },
      onRender: (props) => {},
      onAsyncRender: async (props) => {
        ztoolkit.log("section async render", props);
        // props.setL10nArgs(`{"count": "${0}"}`);
        const isReader = props.tabType === "reader";
        const doc = props.body.ownerDocument!;

        if (isReader) {
          const reader = await ztoolkit.Reader.getReader();

          if (reader === undefined) return;

          if (reader.type === "pdf") {
            const references = await PDF.getReferences(reader);
            ztoolkit.log("references", references);
            props.setL10nArgs(`{"count": "${references.length}"}`);
            const promises = references.map((r) => {
              const url = r.url || `https://doi.org/${r.identifiers.DOI}`;
              return this.cardCache.getAsync(url);
            });
            const cards = (await Promise.all(promises)).filter(
              (card) => card !== undefined,
            );
            props.body.textContent = "";
            const els = cards.map((card, i) => createRow(doc, card));
            props.body.append(...els);
          } else if (reader.type === "snapshot") {
            // const snapshot = (reader as _ZoteroTypes.ReaderInstance<'snapshot'>)._internalReader._lastView;
            // ztoolkit.log(snapshot);
          }
          // TODO: Fetch DOI sources https://api.crossref.org/works/${DOI}/transform/application/vnd.citationstyles.csl+json
          // CKN https://kns.cnki.net/kns8/Brief/GetGridTableHtml
        }
      },
      onItemChange: (props) => {
        const isReader = props.tabType === "reader";
        props.setEnabled(isReader);
      },
      // onToggle: (props) => {
      //   ztoolkit.log("section toggle", props);
      // },
      onDestroy: (props) => {
        ztoolkit.log("section destroy", props);
      },
    });
  }

  static async addCardToSemble(
    item: Zotero.Item,
    collectionIds?: string[],
    showProgress = true,
  ) {
    const progress = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeTime: 5000,
    }).createLine({
      type: "success",
      text: "Saving card to Semble.",
      progress: 50,
    });

    if (showProgress) {
      progress.show();
    }

    try {
      const url = getURLFromItem(item);

      let note = "";

      // TODO: parse HTML to plaintext
      // const syncNotes = true;
      // if (syncNotes) {
      //   note += Zotero.Items.get(item.getNotes())
      //     .map((note) => note.note)
      //     .join("\n---\n");
      // }

      if (getPref("syncTags")) {
        note += item
          .getTags()
          .map(({ tag }) => `#${tag}`)
          .join(" ");
      }

      const urlResult = await this.client.cards.addUrlToLibrary({
        body: { url, collectionIds, note },
      });

      if (urlResult.status !== 200) {
        const text =
          collectionIds && collectionIds.length > 0
            ? " Check if you have access to modify this collection."
            : "";
        progress
          .changeLine({
            type: "fail",
            text: "Error saving card to Semble." + text,
            progress: 0,
          })
          .show();
        return;
      }

      if (getPref("syncConnections")) {
        const connectionsPromise = item
          .getRelationsByPredicate("dc:relation")
          .map((uri) => {
            const data = Zotero.URI.getURIItemLibraryKey(uri);

            if (!data || !data.key || data.objectType !== "item")
              return Promise.resolve();

            const id = Zotero.Items.getIDFromLibraryAndKey(
              data.libraryID,
              data.key,
            );

            if (!id) return Promise.resolve();

            const relatedItem = Zotero.Items.get(id);
            const relateURL = getURLFromItem(relatedItem);

            return this.client.connections.createConnection({
              body: {
                targetType: "URL",
                targetValue: relateURL,
                sourceType: "URL",
                sourceValue: url,
                connectionType: "RELATED",
              },
            });
          });

        await Promise.allSettled([connectionsPromise]);

        progress.changeLine({
          type: "success",
          text: "Saved card to Semble.",
          progress: 99,
        });
      }
    } catch (e) {
      progress
        .changeLine({
          type: "fail",
          text: "Error saving card to Semble.",
          progress: 0,
        })
        .show();
    }
  }
}

/**
 async function ensureProfilePrefs() {
  const currentApiKey = getPref("apiKey");

  if (currentApiKey) {
    Zemble.setAPIKey(currentApiKey);
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
      Zemble.setAPIKey(newApiKey);
    }
  }
}
 */
