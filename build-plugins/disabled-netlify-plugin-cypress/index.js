// Stand-in that disables the "netlify-plugin-cypress" plugin installed in the Netlify UI.
// Remove this package once the plugin is uninstalled from the dashboard.
module.exports = {
  onPreBuild() {
    console.log("Skipping netlify-plugin-cypress (disabled for this project)");
  },
};
