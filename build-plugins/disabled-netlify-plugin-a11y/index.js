// Stand-in that disables the "netlify-plugin-a11y" plugin installed in the Netlify UI.
// Remove this package once the plugin is uninstalled from the dashboard.
module.exports = {
  onPreBuild() {
    console.log("Skipping netlify-plugin-a11y (disabled for this project)");
  },
};
