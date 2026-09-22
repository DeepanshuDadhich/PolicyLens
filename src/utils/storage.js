export function getLocal(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result[key]));
  });
}

export function setLocal(key, value) {
  return chrome.storage.local.set({ [key]: value });
}
