// Stand-in that disables the "strapi-plugin-netlify-deployments" plugin installed in the Netlify UI.
// Remove this package once the plugin is uninstalled from the dashboard.
module.exports = {
  onPreBuild() {
    console.log("Skipping strapi-plugin-netlify-deployments (disabled for this project)");
  },
};
