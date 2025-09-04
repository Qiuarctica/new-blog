import { siteConfig } from "@/config";

/**
 * 生成页面标题
 * @param title 页面标题
 * @returns 完整的页面标题
 */
export function generatePageTitle(title?: string): string {
  if (title) {
    return `${title} | ${siteConfig.title}`;
  }
  return `${siteConfig.title} - ${siteConfig.subtitle}`;
}

/**
 * 生成页面描述
 * @param description 页面描述
 * @returns 完整的页面描述
 */
export function generatePageDescription(description?: string): string {
  return description || siteConfig.description || `${siteConfig.title} - ${siteConfig.subtitle}`;
}

/**
 * 生成完整的图片URL
 * @param imagePath 图片路径
 * @param siteURL 网站URL
 * @returns 完整的图片URL
 */
export function generateImageURL(imagePath: string, siteURL: URL | string): string {
  return new URL(imagePath, siteURL).toString();
}

/**
 * 清理和验证描述文本，确保符合SEO最佳实践
 * @param description 原始描述
 * @param maxLength 最大长度，默认160字符（Google推荐）
 * @returns 清理后的描述
 */
export function cleanDescription(description: string, maxLength: number = 160): string {
  // 移除HTML标签
  const cleanText = description.replace(/<[^>]*>/g, '');
  
  // 移除多余空白字符
  const trimmedText = cleanText.replace(/\s+/g, ' ').trim();
  
  // 截断到指定长度
  if (trimmedText.length <= maxLength) {
    return trimmedText;
  }
  
  // 在单词边界截断
  const truncated = trimmedText.substring(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(' ');
  
  if (lastSpaceIndex > maxLength * 0.8) {
    return truncated.substring(0, lastSpaceIndex) + '...';
  }
  
  return truncated + '...';
}

/**
 * 生成文章摘要，从内容中提取
 * @param content 文章内容
 * @param maxLength 最大长度
 * @returns 文章摘要
 */
export function extractExcerpt(content: string, maxLength: number = 160): string {
  // 移除frontmatter
  const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---/, '');
  
  // 移除markdown语法
  const plainText = contentWithoutFrontmatter
    .replace(/#{1,6}\s+/g, '') // 移除标题标记
    .replace(/\*\*(.*?)\*\*/g, '$1') // 移除加粗
    .replace(/\*(.*?)\*/g, '$1') // 移除斜体
    .replace(/`(.*?)`/g, '$1') // 移除内联代码
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 移除链接，保留文本
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // 移除图片
    .replace(/```[\s\S]*?```/g, '') // 移除代码块
    .replace(/\n+/g, ' ') // 将换行替换为空格
    .trim();

  return cleanDescription(plainText, maxLength);
}

/**
 * 验证并格式化标签
 * @param tags 标签数组
 * @returns 格式化后的标签数组
 */
export function formatTags(tags: string[]): string[] {
  return tags
    .filter(tag => tag && tag.trim().length > 0)
    .map(tag => tag.trim().toLowerCase())
    .filter((tag, index, array) => array.indexOf(tag) === index); // 去重
}

/**
 * 生成breadcrumb结构化数据
 * @param items 面包屑项目
 * @param baseURL 基础URL
 * @returns 结构化数据
 */
export function generateBreadcrumbLD(
  items: Array<{ name: string; url?: string }>,
  baseURL: string
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.name,
      ...(item.url && { "item": new URL(item.url, baseURL).toString() })
    }))
  };
}

/**
 * 生成FAQ结构化数据
 * @param faqs FAQ项目
 * @returns 结构化数据
 */
export function generateFAQLD(faqs: Array<{ question: string; answer: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer
      }
    }))
  };
}
