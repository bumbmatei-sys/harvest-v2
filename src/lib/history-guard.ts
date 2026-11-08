// Install before Next hydration: its popstate handler can synchronously unmount an editor
// before a later window listener runs. In browsers without Navigation API, offer a cancelable
// internal event first. With no active blocker this is a no-op. No history/visitor data is stored.
export const historyGuardBootstrap = `(function(){if(typeof window.navigation!=="undefined"||window.__harvestHistoryBridge)return;window.__harvestHistoryBridge=true;window.addEventListener("popstate",function(event){if(!window.dispatchEvent(new Event("harvest-before-history",{cancelable:true})))event.stopImmediatePropagation()},true)})()`;
