// Stand-in that disables the "@algolia/netlify-plugin-crawler" plugin installed in the Netlify UI.
// Remove this package once the plugin is uninstalled from the dashboard.
module.exports = {
  onPreBuild() {
    console.log("Skipping @algolia/netlify-plugin-crawler (disabled for this project)");
  },
};
