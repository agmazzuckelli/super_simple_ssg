# Super Simple Static Site Generator

This tool will read a source directory you specify, and output a build directory that can be served by any static site hosting service.

Usage - clone the repo, change into that directory, and then run `npm run dev path_to_source_dir`.

## Static Site Generation Background

It's useful to remember what the point of static site generation is. The ultimate goal is to produce a set of files that a client can request, and that a simple file server can serve (static site hosters allow you to use a file server, they don't give you a web server that can handle dynamic endpoints). These files are typically HTML, JS, CSS, and image files. Constructing HTML by hand is possible, but tedious. Further, when you want to enhance the markup, say with inline-styles, that quickly becomes untenable (likely to make mistakes, likely to be inconsistent) to do by hand. A SSG tool aims to ease the burden of producing these outputs.

Many people are familiar with the Markdown language, which is easy to write in (and easy to read), and which is easily convertible to HTML (a different form of markup). So, most static site generation tools support transforming markdown into HTML.

Consider other common workflow slowdowns. You can render markdown to HTML, but that HTML will likely need to be wrapped in the body of a complete HTML page. So, tools let you provide a template, and they then insert the rendered HTML where the content should go. You also may want some more unique styling aspects, such as syntax highlighting. One way to do this is to insert inline styles to the rendered HTML content. As the markdown is parsed and transformed to HTML, certain elements can be targeted and styles inserted.

Finally, there are conventions as to (1) how the final output content should be displayed on, for example, a homepage, and (2) whether content should be filterable, for example by having various tags. In the first case, the tool will likely have a default output, and if you want a different layout, you'll have to specify it. In the second case, it is very common to provide "[frontmatter](https://www.reddit.com/r/ObsidianMD/comments/15hr7ix/frontmatter/)" at the top of a markdown page. Tools will read these as key-value metadata. HTML artifacts that can be used to filter or group content can then be generated. Again, the way this is done is tool-specific, as a lot depends on how the tool expects the average user will want to use the parsed metadata.

So, what most people expect when they use a SSG tool is that at the very least they can write markdown, with some metadata, have the content markdown rendered to HTML (within templates, and possibly with some extra bits added to the HTML like styles), and be able to use the metadata in an obvious way. It should be fairly easy to create a page with a custom layout using the tool.

So, what does this tool do?

## This Tool's Rules

This tool provides the base functionality described above. You can write markdown and provide a set of templates to render that markdown into. The tool will create HTML files with that content. It handles a couple of custom pages, including laying out a homepage and an about page with specific layouts. It handles specific metadata key-value pairs in a specific way, and doesn't do anything with others.

In words, here is how the tool works.

It expects to be provided a source directory. In the source directory it expects a few things:

1. A `content` directory.
   - This should have markdown files (expects `.md` extensions). Each `.md` file:
     - Should start with a set of `key: value` pairs, each of which is parsed as metadata. The key and value within each pair is separated by a colon (`:`), and each pair should be on its own line
       - Typically, you should include a `title: ..` pair, which will render as that page's title. If you do not provide this, the file name will be used as the title (slightly tweaked by the `toTitleCase` function)
       - It's also common to have a `published_date: ..` pair
     - Should then have a line with `---` to separate the metadata from content
     - Below the `---` line, content written in markdown
   - It can contain a directory called `drafts`, which will be ignored when creating HTML files
2. An `assets` directory
   - Items in this folder will be directly copied, without change, to the build directory
   - You might place your JS, CSS, and images here
3. A `templates` directory. This tool expects 3 templates:
   a. `templates/article.html` - Each markdown file will be rendered into this template. The tool will look for `{{ content }}` in this template, and replace it with the rendered HTML for a given post
   b. `templates/about.html` - This template expects an `about.md` file in the `content` directory. It will render the markdown in that file into a `{{ content }}` target in the template
   - For both the article and about templates, the tool also targets the following for replacement. They are replaced by the values of metadata keys with the same name (e.g. the value of the `title` metadata key will be placed in `{{ title }}`). Note that if your template doesn't include these, they simply won't be replaced:
     - `{{ title }}` - If not provided as a `title: ..` key-value pair in the file's metadata, the tool will insert the filename as the title
     - `{{ published_date }}` - This should typically be in `yyyy-mm-dd` format, or there may be issues with parsing
     - `{{ last_modified_date }}` - If a `published_date: ..` is provided in the file's metadata, but a `last_modified_date: ..` is not, the tool will use the `published_date` value to replace the `last_modified_date` field in the template
   - You can view the replacements that happen in the `createArticles` function. You should be able to easily adjust these replacements to match your templates, if you want to rename them or create your own targets using other key-value metadata
     c. `templates/homepage.html` - This template is tied to the `createHomepage` function in the tool. The tool provides a sample template and function implementation, although you can provide your own layout, and adjust the function as necessary. By default, the homepage will parse all of the markdown files, grab `published_dates` (or use 1900 if there is no `published_date`) group them by year, and display them (their titles) on the homepage as clickable links. The years are sorted in descending order, and the articles are sorted in descending order within each year group (by `published_date`). `{{ articles }}` is targeted in the template

Samples of the templates can be found in the `samples/templates` directory in the repo.

When the tool runs against a source directory with the items above, it will output a build. The build output directory is `build/`, placed within the source directory (i.e. `source_directory/build`). The build directory will look like:

```
build/
  about/
  assets/
  content/
  index.html
```

Each article, including the `about` article, is placed within a directory named the same as the article, and the article is named `index.html`. For example, `about.md` is rendered at `build/about/index.html`. `content/sample_article.md` is rendered at `build/content/sample-article/index.html`. There are 2 things to note in the preceding examples. First, `about.md` in the content directoy is placed as the only article at the top level other than the homepage. Second, underscores in article filenames are replaced with hyphens, which are more common in URLS (the associated URLs for the examples above are `www.site.com/about/` and `www.site.com/content/sample-article/`). Each article is made into `article-name/index.html` because [Cool URIs don't change](https://www.w3.org/Provider/Style/URI).

The assets are simply copied over from the source directory. The top level `index.html` is what is produced by `createHomepage`.

That's all there is to it! If you want to modify how the tool works, including handling additional metadata, you just need to know:

- how it works by default as described above
- that `createArticles` reads MD files and outputs complete HTML files, using metadata to replace specific targets in the article.html template, and that you can easily modify the logic of this function to accommodate different metadata/templates
- that the homepage is generated by the `createHomepage` function, in a very specific fashion as described above, but which you can modify to parse and output the way you'd like
- `SETTINGS` in `index.ts` layout these defaults, which you can modify as you wish

#### Extras - Options, Emojis, and Syntax Highlighting
This tool uses `markdownit` under the hood to render HTML from markdown. The markdownit object has several settings you can tweak that affect the ultimate HTML that is outputted. This tool explicitly sets 2 of these settings. It sets `linkify` to `true`, so url-like strings become links in the rendered HTML. It sets `html` to `false`, so that any valid HTML that is included in an MD file is not rendered as an HTML element (rather when you view the HTML file, you will actually see the HTML code still itself).

Finally, markdownit allows the use of plugins, that take part in the HTML rendering lifecycle as markdownit processes a piece of markdown into HTML. This tool uses `markdown-it-emoji`, so that you can add emoji shortcuts that are looked up and replaced with the emoji itself in the rendered HTML (e.g. `:smile:` becomes the emoji itself). The tool also uses `shiki-js` as a plugin to insert inline styles to the rendered HTML for fenced (```, ~~~) code blocks. There is a default theme picked, although of course you can change this as you wish.
