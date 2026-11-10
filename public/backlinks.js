(function () {
  var form = document.getElementById("bl-form");
  var input = document.getElementById("bl-domain");
  var button = document.getElementById("bl-submit");
  var status = document.getElementById("bl-status");
  var results = document.getElementById("bl-results");
  var meta = document.getElementById("bl-meta");
  var fmt = new Intl.NumberFormat("en-US");

  function show(id, value) {
    document.getElementById(id).textContent = value == null ? "–" : fmt.format(value);
  }

  function check(domain) {
    status.textContent = "Checking " + domain + "…";
    status.className = "bl-status";
    button.disabled = true;
    fetch("/api/backlinks?domain=" + encodeURIComponent(domain))
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || "Lookup failed. Please try again.");
          return body;
        });
      })
      .then(function (data) {
        show("bl-backlinks", data.backlinks);
        show("bl-domains", data.referringDomains);
        show("bl-score", data.authorityScore);
        results.hidden = false;
        status.textContent = "Results for " + data.domain;
        meta.textContent = "Checked " + new Date(data.checkedAt).toLocaleString() + (data.stale ? " (showing the last saved result)" : "");
        meta.hidden = false;
        var url = new URL(location.href);
        url.searchParams.set("domain", data.domain);
        history.replaceState(null, "", url);
      })
      .catch(function (err) {
        results.hidden = true;
        meta.hidden = true;
        status.textContent = err.message;
        status.className = "bl-status bl-error";
      })
      .finally(function () { button.disabled = false; });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var domain = input.value.trim();
    if (!domain) { input.focus(); return; }
    check(domain);
  });

  var initial = new URLSearchParams(location.search).get("domain");
  if (initial) { input.value = initial; }
  check(input.value.trim());
})();
