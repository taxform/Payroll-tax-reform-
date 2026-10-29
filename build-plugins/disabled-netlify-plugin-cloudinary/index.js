// Stand-in that disables the "netlify-plugin-cloudinary" plugin installed in the Netlify UI.
// Remove this package once the plugin is uninstalled from the dashboard.
module.exports = {
  onPreBuild() {
    console.log("Skipping netlify-plugin-cloudinary (disabled for this project)");
  },
};
