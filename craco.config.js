// craco.config.js
//
// Create React App 5 already registers a WorkboxWebpackPlugin.InjectManifest
// for src/service-worker.js whenever that file exists, so this config must not
// add a second one — two instances race over the same swDest and the build
// fails with "Can't find self.__WB_MANIFEST in your SW source".
//
// Instead we reconfigure the plugin CRA created, which is the only thing we
// actually need from it: a precache size limit large enough for this bundle.

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      const injectManifest = webpackConfig.plugins.find(
        (plugin) => plugin?.constructor?.name === 'InjectManifest'
      );

      if (injectManifest) {
        // Default is 2 MiB, which silently drops large chunks from the
        // precache and breaks offline support for them.
        injectManifest.config.maximumFileSizeToCacheInBytes = 5 * 1024 * 1024;
      }

      return webpackConfig;
    },
  },
};
