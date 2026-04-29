chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    if (tab.url.includes("maths.sparx-learning.com/student/package")) {
      chrome.tabs.setZoom(tabId, 0.8);
      const urlObj = new URL(tab.url);
      const pathParts = urlObj.pathname.split("/");
      const packageIndex = pathParts.indexOf("package");
      const taskIndex = pathParts.indexOf("task");
      const itemIndex = pathParts.indexOf("item");
      const packageId = packageIndex !== -1 ? pathParts[packageIndex + 1] : null;
      const taskNumber = taskIndex !== -1 ? pathParts[taskIndex + 1] : null;
      const itemNumber = itemIndex !== -1 ? pathParts[itemIndex + 1] : null;
      const itemLetter = itemNumber ? String.fromCharCode(64 + parseInt(itemNumber)) : '';
      const label = `${taskNumber}${itemLetter}`;

      console.log(`[ACT] START ${packageId} ${taskNumber} ${itemLetter}`);

      chrome.storage.local.get(['bookwork'], (data) => {
        const bookwork = data.bookwork || [];
        bookwork.push({ label, answer: null });
        chrome.storage.local.set({
          bookwork,
          currentQuestion: label,
          lastAnswer: null,
          lastScreenshot: null
        });
      });

    } else if (tab.url.includes("maths.sparx-learning.com")) {
      chrome.tabs.setZoom(tabId, 1.0);
    }
  }
}); 