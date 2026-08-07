import { Zemble } from "./modules/zemble";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  Zemble.init();

  Zemble.registerPreferences();

  // ensureProfilePrefs();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;

  Zemble.registerItemMenu();

  Zemble.registerCollectionMenu();

  Zemble.registerItemColumns();

  // Zemble.registerItemPanel();
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

  win.document.l10n?.addResourceIds([
    `${addon.data.config.addonRef}-panel.ftl`,
  ]);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  win.document.l10n?.removeResourceIds([
    `${addon.data.config.addonRef}-panel.ftl`,
  ]);
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
  ztoolkit.log("pref event", type, data);

  if (type === "apiKey") {
    Zemble.setAPIKey(data.value);
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
