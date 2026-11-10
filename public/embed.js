/* PayrollTaxReform.com embeddable payroll calculator widget (v1).
 * Usage on any third-party page:
 *   <div data-ptr-calculator></div>
 *   <script src="https://payrolltaxreform.com/embed.js" async></script>
 * The widget renders inline (no iframe) and includes a followed attribution
 * link to https://payrolltaxreform.com/calculator.html — please keep it intact.
 */
(function () {
  "use strict";

  var CALC_URL = "https://payrolltaxreform.com/calculator.html";
  var DEFAULT_WAGE_BASE = 184500;

  var FRAME_STYLE =
    "font-family:Arial,Helvetica,sans-serif;background:#172944;color:#e9edf5;" +
    "border:1px solid rgba(213,171,86,.45);border-radius:12px;padding:22px;" +
    "max-width:520px;line-height:1.55;font-size:15px;";

  var INPUT_STYLE =
    "width:100%;box-sizing:border-box;padding:11px 13px;margin:6px 0 12px;" +
    "border-radius:8px;border:1px solid rgba(213,171,86,.45);background:#0d1a2d;" +
    "color:#fff;font-size:15px;";

  var BTN_STYLE =
    "display:inline-block;background:#d5ab56;color:#111827;border:none;" +
    "border-radius:7px;padding:12px 20px;font-weight:700;font-size:15px;cursor:pointer;";

  function money(value) {
    try {
      return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
    } catch (e) {
      return "$" + value.toFixed(2);
    }
  }

  function buildWidget(mount) {
    if (mount.getAttribute("data-ptr-ready") === "1") return;
    mount.setAttribute("data-ptr-ready", "1");

    var box = document.createElement("div");
    box.setAttribute("style", FRAME_STYLE);

    var title = document.createElement("div");
    title.setAttribute("style", "font-weight:800;font-size:18px;margin-bottom:4px;");
    title.textContent = "Free Employer Payroll Tax Calculator";
    box.appendChild(title);

    var sub = document.createElement("div");
    sub.setAttribute("style", "color:#b8c3d4;font-size:13px;margin-bottom:12px;");
    sub.textContent = "Estimate employer Social Security (6.2%) + Medicare (1.45%).";
    box.appendChild(sub);

    var labels = [
      ["Gross wages (this pay period)", "2000"],
      ["SS-taxable wages already paid this year", "25000"],
      ["Annual Social Security wage base", String(DEFAULT_WAGE_BASE)]
    ];

    var inputs = labels.map(function (item) {
      var lab = document.createElement("label");
      lab.setAttribute("style", "display:block;font-weight:700;font-size:13px;");
      lab.textContent = item[0];
      var inp = document.createElement("input");
      inp.setAttribute("type", "number");
      inp.setAttribute("min", "0");
      inp.setAttribute("placeholder", "Example: " + item[1]);
      inp.setAttribute("style", INPUT_STYLE);
      inp.setAttribute("aria-label", item[0]);
      box.appendChild(lab);
      box.appendChild(inp);
      return inp;
    });

    var btn = document.createElement("button");
    btn.setAttribute("type", "button");
    btn.setAttribute("style", BTN_STYLE);
    btn.textContent = "Calculate Employer Taxes";
    box.appendChild(btn);

    var out = document.createElement("div");
    out.setAttribute("style", "margin-top:14px;font-size:14px;");
    out.setAttribute("role", "status");
    out.setAttribute("aria-live", "polite");
    box.appendChild(out);

    var credit = document.createElement("div");
    credit.setAttribute("style", "margin-top:12px;font-size:12px;color:#b8c3d4;");
    credit.innerHTML =
      'Powered by <a href="' +
      CALC_URL +
      '" style="color:#d5ab56;font-weight:700;">PayrollTaxReform.com payroll tax calculator</a>';
    box.appendChild(credit);

    btn.addEventListener("click", function () {
      var raw = [inputs[0].value, inputs[1].value, inputs[2].value];
      var empty = raw.some(function (v) { return String(v).trim() === ""; });
      var wages = Number(raw[0]);
      var ytd = Number(raw[1]);
      var base = Number(raw[2]) || DEFAULT_WAGE_BASE;
      if (empty || !isFinite(wages) || !isFinite(ytd) || wages < 0 || ytd < 0 || base <= 0) {
        out.textContent = "Please enter valid payroll amounts.";
        return;
      }
      var taxable = Math.min(wages, Math.max(0, base - ytd));
      var ss = taxable * 0.062;
      var med = wages * 0.0145;
      out.innerHTML =
        "<div>Employer Social Security: <strong>" + money(ss) + "</strong></div>" +
        "<div>Employer Medicare: <strong>" + money(med) + "</strong></div>" +
        "<div style='font-size:20px;font-weight:800;color:#d5ab56;margin-top:6px;'>Total: " +
        money(ss + med) +
        "</div>" +
        "<div style='color:#b8c3d4;font-size:12px;'>Educational estimate only. Excludes FUTA, SUI, and income-tax withholding.</div>";
    });

    mount.appendChild(box);
  }

  function init() {
    var mounts = document.querySelectorAll("[data-ptr-calculator]");
    for (var i = 0; i < mounts.length; i++) {
      try {
        buildWidget(mounts[i]);
      } catch (e) {
        /* never break the host page */
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
