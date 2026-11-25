import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const Q = String.fromCharCode(34);
const home = read("public/index.html");
const landing = read("public/payrollcheck/index.html");
const sitemap = read("public/sitemap.xml");
const CTA_PAGES = [
["public/tools/payroll-tax-calculator.html", "Is the number you just calculated actually right?"],
["public/tools/payroll-compliance-audit.html", "Want to know if your payroll is really compliant?"],
["public/tools/first-hire.html", "Hiring your first employee? Check the setup before you pay."],
["public/calculator.html", "Want a second look at your payroll taxes?"],
["public/backlinks.html", "Your site links are checked. What about your payroll?"],
["public/updates.html", "Payroll tax rules keep changing. Are your filings keeping up?"],
["public/payroll.html", "Want to know if your 941s are right?"],
["public/states.html", "State rules differ. Are your filings right in your state?"],
["public/resources.html", "Found the form you need? Check the filing behind it."],
["public/research/2026-payroll-tax-rates-deadlines.html", "Know the 2026 rates and deadlines. Now check your filings against them."],
["public/research/employer-payroll-tax-by-salary-2026.html", "Know what an employee costs. Now check whether you paid it right."],
["public/software.html", "Choosing software? First check whether your filings are right."],
["public/services.html", "Want to know if your payroll is right?"],
["public/about.html", "We built PayrollCheck 360"],
["public/blog.html", "Reading about payroll taxes? Check your own filings too."]
];
test("homepage hero leads with PayrollCheck 360", () => {
assert.equal(home.includes("<h1>Find your payroll mistakes before the IRS does.</h1>"), true);
assert.equal(home.includes("One flat $299 a year, filing fees included."), true);
assert.equal(home.includes("Start your free audit"), true);
assert.equal(home.includes("href=" + Q + "/payrollcheck" + Q), true);
assert.equal(home.includes("use the free payroll tax calculator"), true);
assert.equal(home.includes("file right in the app"), false);
});
test("payrollcheck landing page is indexable and listed in the sitemap", () => {
assert.equal(landing.includes("noindex"), false);
assert.equal(sitemap.includes("<loc>https://payrolltaxreform.com/payrollcheck/</loc>"), true);
assert.equal(read("public/payrollcheck/accounting/index.html").includes("noindex"), true);
assert.equal(read("public/payrollcheck/business/index.html").includes("noindex"), true);
});
const collect = (dir, out) => {
for (const name of readdirSync(dir)) {
const p = dir + "/" + name;
if (statSync(p).isDirectory()) {
collect(p, out);
} else if (name.endsWith(".html")) {
out.push(p);
}
}
};
test("main nav links to PayrollCheck 360 on every main page except blog articles", () => {
const all = [];
collect("public", all);
const navPages = all.filter((p) => read(p).includes("class=" + Q + "mainnav" + Q) && p.indexOf("public/blog/") !== 0);
assert.ok(navPages.length >= 20);
for (const p of navPages) {
assert.equal(read(p).includes("href=" + Q + "/payrollcheck" + Q + ">PayrollCheck 360"), true, p);
}
});
test("every CTA page has one PayrollCheck 360 block with a free audit button", () => {
for (const entry of CTA_PAGES) {
const page = entry[0];
const headline = entry[1];
const html = read(page);
assert.equal(html.includes("payrollcheck-cta"), true, page);
assert.equal(html.includes(headline), true, page);
assert.equal(html.includes("Start your free audit"), true, page);
const start = html.indexOf("payrollcheck-cta");
const block = html.slice(start, html.indexOf("</section>", start));
assert.equal(block.includes("TDS"), false, page);
assert.equal(block.includes("IVES"), false, page);
assert.equal(block.includes("IRS-sourced"), false, page);
assert.equal(block.includes("file in the app"), false, page);
}
});
test("calculator pages link to PayrollCheck 360 in their own nav", () => {
assert.equal(read("public/calculator.html").includes("href=" + Q + "/payrollcheck" + Q + ">PayrollCheck 360"), true);
assert.equal(read("public/tools/payroll-tax-calculator.html").includes("https://payrolltaxreform.com/payrollcheck"), true);
});
