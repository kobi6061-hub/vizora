/* PROPX · Deal Decision Lab — page module (scaffold). Mounts into #dlRoot; loaded after the main script (live build only).
   Follows the page's language through the "propx:lang" event and the opened geography through "propx:geo". */
(function () {
  'use strict';
  var root = document.getElementById('dlRoot');
  if (!root) return;
  root.hidden = true;
}());
