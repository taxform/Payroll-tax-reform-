/* Automatic blog listing for PayrollTaxReform.com.
 *
 * Any element with [data-blog-list] is filled in from /blog/posts.json,
 * newest post first. Optional attributes:
 *   data-blog-list-count="3"  — show only the first N posts (omit for all)
 *   data-blog-list-badge="x"  — show only posts with this badge (omit for all)
 *
 * To publish a new article: add the HTML file under /blog/, then add one
 * entry at the top of /blog/posts.json. Every list on the site updates
 * on its own. If the feed cannot load, the server-rendered cards already
 * in the HTML stay in place, so search engines and no-JS visitors are
 * unaffected.
 */
(function () {
  "use strict";

  var FEED_URL = "/blog/posts.json";

  function makeCard(post) {
    var card = document.createElement("article");
    card.className = "card";

    if (post.badge) {
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = post.badge;
      card.appendChild(badge);
    }

    var heading = document.createElement("h3");
    heading.textContent = post.title;
    card.appendChild(heading);

    if (post.excerpt) {
      var excerpt = document.createElement("p");
      excerpt.textContent = post.excerpt;
      card.appendChild(excerpt);
    }

    var link = document.createElement("a");
    link.href = post.url;
    link.textContent = "Read article \u2192";
    card.appendChild(link);

    return card;
  }

  function render(mount, posts) {
    var count = parseInt(mount.getAttribute("data-blog-list-count") || "0", 10);
    var badgeFilter = (mount.getAttribute("data-blog-list-badge") || "").toLowerCase();

    var list = posts.filter(function (post) {
      return (
        post &&
        post.title &&
        post.url &&
        (!badgeFilter || (post.badge || "").toLowerCase() === badgeFilter)
      );
    });

    if (count > 0) list = list.slice(0, count);
    if (!list.length) return;

    mount.replaceChildren.apply(
      mount,
      list.map(makeCard)
    );

    var counter = mount.parentElement
      ? mount.parentElement.querySelector("[data-blog-count]")
      : null;
    if (counter) counter.textContent = String(list.length);
  }

  async function init() {
    var mounts = document.querySelectorAll("[data-blog-list]");
    if (!mounts.length) return;

    var response;
    try {
      response = await fetch(FEED_URL, {
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      return;
    }
    if (!response || !response.ok) return;

    var posts;
    try {
      posts = await response.json();
    } catch (err) {
      return;
    }
    if (!Array.isArray(posts) || !posts.length) return;

    mounts.forEach(function (mount) {
      render(mount, posts);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
