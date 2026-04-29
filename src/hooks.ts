async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // initLocale();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
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
              url.searchParams.set("id", item.getField("url"));

              urls.push(url.toString());
            }
          }

          ztoolkit.log(urls);
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

          ztoolkit.log(urls);
          pane.loadURI(urls);
        },
      },
    ],
    icon: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });
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
 * Any operations should be placed in a function to keep this funcion clear.
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
 * Any operations should be placed in a function to keep this funcion clear.
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
