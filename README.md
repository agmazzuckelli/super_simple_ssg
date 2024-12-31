# Super Simple Static Site Generator

The purpose of this package is to render a static blog in a prescribed way.

Point it to a directory of markdown files and a template html file. Each file can have a set of labels at the top. It will parse these files and generate:

- 1 html file per `.md` file with the same name
- 1 index.html file that will serve as the homepage. This page will feature a list of articles, and input boxes to filter by the labels assigned to each article

The output directory can then be served as an entrypoint on any popular static site hosting provider.

## Usage
