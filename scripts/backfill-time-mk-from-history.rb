require 'fileutils'
require 'time'
require 'open3'
require 'yaml'

ROOT = File.expand_path('..', __dir__)
ARTICLES_YML = File.join(ROOT, '_data', 'articles.yml')
COLLECTION_DIR = File.join(ROOT, '_articles')
BASE_URL = 'https://time.mk'
SCRAPED_PREFIX = 'time-mk-'
MAX_STORED_ARTICLES = 50
AUTO_COMMIT_MESSAGE = '^auto: refresh time.mk articles'

def git_output(*args)
  output, status = Open3.capture2('git', '-C', ROOT, *args)
  raise "git #{args.join(' ')} failed" unless status.success?

  output
end

def normalize_title(value)
  String(value).downcase.gsub(/\s+/, ' ').strip
end

def yaml_quote(value)
  '"' + String(value).gsub('\\', '\\\\').gsub('"', '\"') + '"'
end

def parse_articles(yaml)
  Array(YAML.safe_load(String(yaml), permitted_classes: [Time], aliases: true))
    .map do |article|
      next unless article.is_a?(Hash)

      {
        'id' => article['id'],
        'title' => article['title'],
        'source' => article['source'],
        'published_at' => article['published_at'],
        'category' => article['category'],
        'image' => article['image'],
        'url' => article['url'],
        'excerpt' => article['excerpt']
      }
    end
    .compact
    .select { |article| article['id'] && article['title'] }
end

def build_yaml_article(article, index)
  [
    "- id: #{article['id']}",
    "  title: #{yaml_quote(article['title'])}",
    "  source: #{yaml_quote(article['source'])}",
    "  published_at: #{yaml_quote(article['published_at'])}",
    "  category: #{yaml_quote(article['category'])}",
    "  image: #{yaml_quote(article['image'])}",
    "  url: #{yaml_quote(article['url'])}",
    "  excerpt: #{yaml_quote(article['excerpt'])}",
    "  featured: #{index.zero? ? 'true' : 'false'}"
  ].join("\n")
end

def build_collection_markdown(article, index)
  [
    '---',
    'layout: article',
    "title: #{yaml_quote(article['title'])}",
    "source: #{yaml_quote(article['source'])}",
    "published_at: #{yaml_quote(article['published_at'])}",
    "category: #{yaml_quote(article['category'])}",
    "image: #{yaml_quote(article['image'])}",
    "excerpt: #{yaml_quote(article['excerpt'])}",
    "featured: #{index.zero? ? 'true' : 'false'}",
    "external_url: #{yaml_quote(article['url'])}",
    '---',
    article['excerpt'].to_s,
    '',
    "Оваа ставка е автоматски повлечена од #{BASE_URL} преку GitHub Actions scraper.",
    '',
    "Оригинален линк: #{article['url']}",
    ''
  ].join("\n")
end

commits = git_output('log', '--format=%H', "--grep=#{AUTO_COMMIT_MESSAGE}", '-n', '20').split
raise 'No auto-refresh commits found' if commits.empty?

articles = []
seen_titles = {}

commits.each do |commit|
  yaml = git_output('show', "#{commit}:_data/articles.yml")

  parse_articles(yaml).each do |article|
    normalized_title = normalize_title(article['title'])
    next if normalized_title.empty? || seen_titles[normalized_title]

    seen_titles[normalized_title] = true
    articles << article
    break if articles.length >= MAX_STORED_ARTICLES
  end

  break if articles.length >= MAX_STORED_ARTICLES
end

articles.sort_by! do |article|
  begin
    Time.iso8601(article['published_at'])
  rescue StandardError
    Time.at(0)
  end
end
articles.reverse!

used_ids = {}
articles.each do |article|
  base_id = article['id']
  suffix = 2

  while used_ids[article['id']]
    article['id'] = "#{base_id}-#{suffix}"
    suffix += 1
  end

  used_ids[article['id']] = true
end

File.write(ARTICLES_YML, articles.each_with_index.map { |article, index| build_yaml_article(article, index) }.join("\n\n") + "\n")
FileUtils.mkdir_p(COLLECTION_DIR)

Dir.glob(File.join(COLLECTION_DIR, "#{SCRAPED_PREFIX}*.md")).each do |article_path|
  File.delete(article_path)
end

articles.each_with_index do |article, index|
  File.write(File.join(COLLECTION_DIR, "#{article['id']}.md"), build_collection_markdown(article, index))
end

puts({
  commits_considered: commits.length,
  restored: articles.length,
  newest_id: articles.first&.fetch('id', nil),
  oldest_id: articles.last&.fetch('id', nil)
})
