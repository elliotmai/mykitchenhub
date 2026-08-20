// craco.config.js
//
// Create React App 5 already registers a WorkboxWebpackPlugin.InjectManifest
// for src/service-worker.js whenever that file exists, so this config must not
// add a second one — two instances race over the same swDest and the build
// fails with "Can't find self.__WB_MANIFEST in your SW source".
//
// Instead we reconfigure the plugin CRA created, which is the only thing we
// actually need from it: a precache size limit large enough for this bundle.

const { execSync } = require('child_process');
const webpack = require('webpack');

/**
 * A short identifier for *this build*, as opposed to this version.
 *
 * APP_VERSION is a roadmap coordinate by design, so several builds legitimately
 * carry the same one — five shipped as 0.10.6. That makes the footer unable to
 * answer the only question anyone asks it after tapping Update: did the new
 * code actually land. This can, because it changes whenever the commit does.
 *
 * The git SHA where there is one, falling back to a timestamp so a build from
 * a tarball or a detached checkout still gets something unique rather than a
 * constant that would quietly reintroduce the problem.
 */
const buildId = () => {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return `t${Date.now().toString(36)}`;
  }
};

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      webpackConfig.plugins.push(
        new webpack.DefinePlugin({
          'process.env.REACT_APP_BUILD_ID': JSON.stringify(buildId()),
        })
      );

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
