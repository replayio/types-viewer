module.exports = {
  mode: "development",
  entry: "./src/main",
  devtool: "source-map",
  resolve: {
    modules: [
      "src",
    ],
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          "style-loader",
          {
            loader: "css-loader",
            options: {
              importLoaders: 1,
              url: false,
            },
          }
        ],
      },
    ],
  },
  output: {
    filename: "typesMain.js"
  },
};
