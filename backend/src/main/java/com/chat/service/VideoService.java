package com.chat.service;

import com.chat.mapper.CommentMapper;
import com.chat.mapper.MediaFolderMapper;
import com.chat.mapper.VideoLikeMapper;
import com.chat.mapper.VideoMapper;
import com.chat.model.MediaFolder;
import com.chat.model.Video;
import com.chat.model.VideoLike;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

@Service
public class VideoService {

    private static final Logger log = LoggerFactory.getLogger(VideoService.class);

    @Resource
    private VideoMapper videoMapper;

    @Resource
    private VideoLikeMapper videoLikeMapper;

    @Resource
    private CommentMapper commentMapper;

    @Resource
    private MediaFolderMapper mediaFolderMapper;

    @Resource
    private ThumbnailService thumbnailService;



    @Value("${chat.thumb-dir:./thumbnails}")
    private String thumbDir;

    @Value("${chat.ffmpeg-path:}")
    private String ffmpegPath;

    private static final String[] VIDEO_EXTENSIONS = {".mp4", ".webm", ".avi", ".mov", ".mkv", ".flv", ".mpg", ".mpeg", ".3gp", ".m4v"};
    private static final String[] IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"};

    /** 标准化路径：统一使用系统分隔符，去除末尾分隔�?*/
    private String normalizePath(String path) {
        if (path == null) return null;
        Path p = Paths.get(path);
        return p.normalize().toString();
    }

    public Map<String, Object> listVideos(int page, int pageSize, Long userId, String type, String category) {
        int offset = (page - 1) * pageSize;
        List<Video> videos;
        int total;

        if (type != null && category != null) {
            videos = videoMapper.findByTypeAndCategory(type, category, offset, pageSize);
            total = videoMapper.countByTypeAndCategory(type, category);
        } else if (type != null) {
            videos = videoMapper.findByType(type, offset, pageSize);
            total = videoMapper.countByType(type);
        } else if (category != null) {
            videos = videoMapper.findByCategory(category, offset, pageSize);
            total = videoMapper.countByCategory(category);
        } else {
            videos = videoMapper.findAll(offset, pageSize);
            total = videoMapper.countAll();
        }

        markLiked(videos, userId);
        Map<String, Object> result = new HashMap<>();
        result.put("list", videos);
        result.put("total", total);
        result.put("page", page);
        result.put("pageSize", pageSize);
        result.put("totalPages", Math.max(1, (total + pageSize - 1) / pageSize));
        return result;
    }

    public Map<String, Object> searchVideos(String keyword, int page, int pageSize, Long userId) {
        int offset = (page - 1) * pageSize;
        List<Video> videos = videoMapper.search(keyword, offset, pageSize);
        int total = videoMapper.countSearch(keyword);
        markLiked(videos, userId);
        Map<String, Object> result = new HashMap<>();
        result.put("list", videos);
        result.put("total", total);
        result.put("page", page);
        result.put("pageSize", pageSize);
        result.put("totalPages", Math.max(1, (total + pageSize - 1) / pageSize));
        return result;
    }

    public List<String> getCategories() {
        return videoMapper.findCategories();
    }

    @Transactional
    public boolean toggleLike(Long videoId, Long userId) {
        VideoLike existing = videoLikeMapper.findByVideoAndUser(videoId, userId);
        if (existing != null) {
            videoLikeMapper.delete(videoId, userId);
            videoMapper.updateLikeCount(videoId, -1);
            return false;
        } else {
            VideoLike like = new VideoLike();
            like.setVideoId(videoId);
            like.setUserId(userId);
            videoLikeMapper.insert(like);
            videoMapper.updateLikeCount(videoId, 1);
            return true;
        }
    }

    // 文件夹管�
public List<MediaFolder> listFolders() {
        return mediaFolderMapper.findAll();
    }

    public MediaFolder addFolder(String path) {
        File dir = new File(path);
        if (!dir.exists() || !dir.isDirectory()) return null;
        for (MediaFolder f : mediaFolderMapper.findAll()) {
            if (f.getPath().equals(path)) return f;
        }
        MediaFolder folder = new MediaFolder();
        folder.setName(dir.getName());
        folder.setPath(path);
        mediaFolderMapper.insert(folder);
        return folder;
    }

    @Transactional
    public String deleteFolder(Long id, boolean deleteData) {
        MediaFolder folder = mediaFolderMapper.findById(id);
        if (folder == null) return null;
        String path = folder.getPath();
        if (!path.endsWith(File.separator)) path += File.separator;
        String prefixLower = path.toLowerCase();

        List<Video> videos = videoMapper.findAllNoLimit();
        // 只统计当前可�?hidden=0或null)的记�
int videoCount = 0, imageCount = 0;
        List<Long> matchIds = new ArrayList<>();
        for (Video v : videos) {
            if (v.getFilePath() != null && v.getFilePath().toLowerCase().startsWith(prefixLower)) {
                if (deleteData) {
                    // 删除数据：统计所有匹配记�
matchIds.add(v.getId());
                    if ("image".equals(v.getType())) imageCount++;
                    else videoCount++;
                } else {
                    // 下架：只统计当前可见的记�
if (v.getHidden() == null || v.getHidden() == 0) {
                        matchIds.add(v.getId());
                        if ("image".equals(v.getType())) imageCount++;
                        else videoCount++;
                    }
                }
            }
        }

        if (deleteData) {
            for (Long vid : matchIds) {
                videoMapper.deleteById(vid);
            }
            if (!matchIds.isEmpty()) {
                videoLikeMapper.deleteByVideoIds(matchIds);
                commentMapper.deleteByVideoIds(matchIds);
            }
        } else {
            for (Long vid : matchIds) {
                videoMapper.hideById(vid);
            }
        }

        mediaFolderMapper.deleteById(id);

        List<String> parts = new ArrayList<>();
        if (videoCount > 0) parts.add(videoCount + "个视频");
        if (imageCount > 0) parts.add(imageCount + "个图片");

        if (parts.isEmpty()) {
            return "已删除文件夹";
        } else if (deleteData) {
            return "已删除文件夹，" + String.join("、", parts) + "相关数据已删除";
        } else {
            return "已删除文件夹，" + String.join("、", parts) + "已下架";
        }
    }

    public ScanResult scanFolder(Long folderId, boolean scanVideo, boolean scanImage, boolean pendingClassify) {
        MediaFolder folder = mediaFolderMapper.findById(folderId);
        if (folder == null) return new ScanResult();
        ScanResult result = new ScanResult();

        List<Video> allVideos = videoMapper.findAllNoLimit();
        Map<String, Video> nameTypeMap = new HashMap<>();
        Map<Long, Integer> preScanHiddenMap = new HashMap<>();
        for (Video v : allVideos) {
            if (v.getFileName() != null && v.getType() != null) {
                String key = v.getFileName().toLowerCase() + "::" + v.getType();
                nameTypeMap.putIfAbsent(key, v);
            }
            preScanHiddenMap.put(v.getId(), v.getHidden() != null ? v.getHidden() : 0);
        }

        String folderName = folder.getName();
        scanAndRefreshFolder(folder.getPath(), folderName, folderName, scanVideo, scanImage, pendingClassify, result, allVideos, nameTypeMap, preScanHiddenMap);
        return result;
    }

    /** scan-all 专用：每个文件夹独立选项，共享数�?*/
    public ScanResult scanAllFoldersShared(List<FolderScanConfig> configs) {
        ScanResult result = new ScanResult();

        List<Video> allVideos = videoMapper.findAllNoLimit();
        Map<String, Video> nameTypeMap = new HashMap<>();
        Map<Long, Integer> preScanHiddenMap = new HashMap<>();
        for (Video v : allVideos) {
            if (v.getFileName() != null && v.getType() != null) {
                String key = v.getFileName().toLowerCase() + "::" + v.getType();
                nameTypeMap.putIfAbsent(key, v);
            }
            preScanHiddenMap.put(v.getId(), v.getHidden() != null ? v.getHidden() : 0);
        }

        for (FolderScanConfig config : configs) {
            MediaFolder folder = mediaFolderMapper.findById(config.folderId);
            if (folder != null) {
                String folderName = folder.getName();
                scanAndRefreshFolder(folder.getPath(), folderName, folderName, config.scanVideo, config.scanImage, config.pendingClassify, result, allVideos, nameTypeMap, preScanHiddenMap);
            }
        }
        return result;
    }

    public static class FolderScanConfig {
        public Long folderId;
        public boolean scanVideo;
        public boolean scanImage;
        public boolean pendingClassify;
    }

    public static class ScanResult {
        public int newVideo;
        public int newImage;
        public int restoredVideo;
        public int restoredImage;
        public int delistedVideo;
        public int delistedImage;

        public String toMessage() {
            List<String> parts = new ArrayList<>();
            if (newVideo > 0) parts.add("新增" + newVideo + "个视频");
            if (newImage > 0) parts.add("新增" + newImage + "个图片");
            if (restoredVideo > 0) parts.add("已恢复" + restoredVideo + "个视频");
            if (restoredImage > 0) parts.add("已恢复" + restoredImage + "个图片");
            if (delistedVideo > 0) parts.add("已下架" + delistedVideo + "个视频");
            if (delistedImage > 0) parts.add("已下架" + delistedImage + "个图片");
            if (parts.isEmpty()) return "无变化";
            return "扫描完成，" + String.join("，", parts);
        }
    }

    // 扫描并刷新：覆盖式扫描，先隐藏再恢复
    private void scanAndRefreshFolder(String folderPath, String parentCategory, String topCategory, boolean scanVideo, boolean scanImage, boolean pendingClassify, ScanResult result, List<Video> allVideos, Map<String, Video> nameTypeMap, Map<Long, Integer> preScanHiddenMap) {
        File folder = new File(folderPath);
        if (!folder.exists() || !folder.isDirectory()) return;

        // 1. 隐藏该目录下所有已有文�
String normFolderPath = normalizePath(folderPath);
        String prefix = normFolderPath.endsWith(File.separator) ? normFolderPath : normFolderPath + File.separator;
        String prefixLower = prefix.toLowerCase();
        for (Video v : allVideos) {
            if (v.getFilePath() != null) {
                String vPath = normalizePath(v.getFilePath());
                if (vPath.toLowerCase().startsWith(prefixLower)) {
                    if (v.getHidden() == null || v.getHidden() == 0) {
                        videoMapper.hideById(v.getId());
                        v.setHidden(1);
                    }
                }
            }
        }

        // 2. 为当前文件夹构建专用的nameTypeMap（避免跨文件夹同名冲突）
        Map<String, Video> folderNameMap = new HashMap<>();
        for (Video v : allVideos) {
            if (v.getFilePath() != null && v.getFileName() != null && v.getType() != null) {
                String vPath = normalizePath(v.getFilePath());
                if (vPath.toLowerCase().startsWith(prefixLower)) {
                    String key = v.getFileName().toLowerCase() + "::" + v.getType();
                    folderNameMap.putIfAbsent(key, v);
                }
            }
        }

        // 2. 扫描子文件夹
        File[] subDirs = folder.listFiles(File::isDirectory);
        if (subDirs != null) {
            for (File subDir : subDirs) {
                String category = subDir.getName();
                scanAndRefreshFolder(subDir.getAbsolutePath(), category, topCategory, scanVideo, scanImage, pendingClassify, result, allVideos, nameTypeMap, preScanHiddenMap);
            }
        }

        // 3. 收集所有媒体文件并提取共有短语
        List<File> allFiles = new ArrayList<>();
        if (scanVideo) {
            File[] videoFiles = folder.listFiles((dir, name) -> {
                String lower = name.toLowerCase();
                for (String ext : VIDEO_EXTENSIONS) {
                    if (lower.endsWith(ext)) return true;
                }
                return false;
            });
            if (videoFiles != null) allFiles.addAll(Arrays.asList(videoFiles));
        }
        if (scanImage) {
            File[] imageFiles = folder.listFiles((dir, name) -> {
                String lower = name.toLowerCase();
                for (String ext : IMAGE_EXTENSIONS) {
                    if (lower.endsWith(ext)) return true;
                }
                return false;
            });
            if (imageFiles != null) {
                for (File f : imageFiles) {
                    if (!f.getName().toLowerCase().contains("_thumb")) allFiles.add(f);
                }
            }
        }

        // 分析共有短语
        List<String> titles = new ArrayList<>();
        for (File f : allFiles) {
            String name = f.getName();
            titles.add(name.contains(".") ? name.substring(0, name.lastIndexOf('.')) : name);
        }
        Set<String> commonPhrases = findCommonPhrases(titles);

        // 4. 导入文件
        for (File file : allFiles) {
            String lower = file.getName().toLowerCase();
            String type = isVideoFile(lower) ? "video" : "image";
            importFile(file, folder, type, parentCategory, topCategory, pendingClassify, commonPhrases, result, folderNameMap, preScanHiddenMap);
        }

        // 5. 统计已下架的记录（仅当前文件夹直接包含的，不含子文件夹）
        for (Video v : allVideos) {
            if (v.getFilePath() != null) {
                String vPath = normalizePath(v.getFilePath());
                String vPathLower = vPath.toLowerCase();
                // 确保在当前文件夹下（以prefix开头）
                if (vPathLower.startsWith(prefixLower)) {
                    // 排除子文件夹：路径去掉prefix后不应再包含分隔�
String relative = vPathLower.substring(prefixLower.length());
                    if (relative.contains(File.separator) || relative.contains("/")) continue;

                    int preHidden = preScanHiddenMap.getOrDefault(v.getId(), 0);
                    if (preHidden == 0 && v.getHidden() != null && v.getHidden() == 1) {
                        boolean typeNotScanned = ("image".equals(v.getType()) && !scanImage) || ("video".equals(v.getType()) && !scanVideo);
                        if (typeNotScanned && new File(v.getFilePath()).exists()) {
                            if ("image".equals(v.getType())) result.delistedImage++;
                            else result.delistedVideo++;
                        }
                    }
                }
            }
        }
    }

    private boolean isVideoFile(String lowerName) {
        for (String ext : VIDEO_EXTENSIONS) {
            if (lowerName.endsWith(ext)) return true;
        }
        return false;
    }

    // 分析文件名中的共有短语（出现3+次的连续词组�
private Set<String> findCommonPhrases(List<String> titles) {
        Set<String> commonPhrases = new LinkedHashSet<>();
        if (titles.size() < 3) return commonPhrases;

        // 统计每个标题中出现的2词和3词短�
Map<String, Integer> phraseCount = new HashMap<>();
        for (String title : titles) {
            String[] words = title.split("[\\s_\\-,;|/\\\\]+");
            List<String> cleaned = new ArrayList<>();
            for (String w : words) {
                w = w.trim();
                if (!w.isEmpty()) cleaned.add(w.toLowerCase());
            }
            // 去重：同一文件中同一短语只算一�
Set<String> seen = new HashSet<>();
            // 2词短�
for (int i = 0; i < cleaned.size() - 1; i++) {
                String phrase = cleaned.get(i) + " " + cleaned.get(i + 1);
                if (seen.add(phrase)) {
                    phraseCount.put(phrase, phraseCount.getOrDefault(phrase, 0) + 1);
                }
            }
            // 3词短�
seen.clear();
            for (int i = 0; i < cleaned.size() - 2; i++) {
                String phrase = cleaned.get(i) + " " + cleaned.get(i + 1) + " " + cleaned.get(i + 2);
                if (seen.add(phrase)) {
                    phraseCount.put(phrase, phraseCount.getOrDefault(phrase, 0) + 1);
                }
            }
        }

        // 筛选出�?+次的短语，按长度降序（优先长的）
        List<Map.Entry<String, Integer>> entries = new ArrayList<>(phraseCount.entrySet());
        entries.sort((a, b) -> {
            int cmp = Integer.compare(b.getValue(), a.getValue());
            if (cmp != 0) return cmp;
            return Integer.compare(b.getKey().length(), a.getKey().length());
        });

        // 收集符合条件的短语，并检查是否有更长的短语已包含�
Set<String> selected = new LinkedHashSet<>();
        for (Map.Entry<String, Integer> e : entries) {
            if (e.getValue() < 3) continue;
            String phrase = e.getKey();
            // 检查是否被已选中的更长短语包�
boolean dominated = false;
            for (String s : selected) {
                if (s.contains(phrase)) { dominated = true; break; }
            }
            if (!dominated) {
                selected.add(phrase);
            }
        }

        return selected;
    }

    // 清理已删除的文件记录
    private void cleanupDeletedFiles(String folderPath) {
        List<Video> allVideos = videoMapper.findAllNoLimit();
        String normFolderPath = normalizePath(folderPath);
        String prefix = normFolderPath.endsWith(File.separator) ? normFolderPath : normFolderPath + File.separator;
        String prefixLower = prefix.toLowerCase();
        for (Video v : allVideos) {
            if (v.getFilePath() != null) {
                String vPath = normalizePath(v.getFilePath());
                if (vPath.toLowerCase().startsWith(prefixLower)) {
                    if (!new File(v.getFilePath()).exists()) {
                        videoMapper.deleteById(v.getId());
                    }
                }
            }
        }
    }

    private void importFile(File file, File folder, String type, String category, String topCategory, boolean pendingClassify, Set<String> commonPhrases, ScanResult result, Map<String, Video> nameTypeMap, Map<Long, Integer> preScanHiddenMap) {
        String absPath = file.getAbsolutePath();
        String fileName = file.getName();
        String title = fileName.contains(".") ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;

        // 1. 按文件名+类型查找（内存Map，最可靠的匹配方式）
        String nameKey = fileName.toLowerCase() + "::" + type;
        Video existing = nameTypeMap.get(nameKey);

        if (existing != null) {
            // 找到�?�?恢复显示
            if (existing.getHidden() != null && existing.getHidden() == 1) {
                videoMapper.unhideById(existing.getId());
                existing.setHidden(0);
                // 只有扫描前就是hidden的才计入"已恢�?（排除hide步骤临时隐藏的）
                if (preScanHiddenMap.getOrDefault(existing.getId(), 0) == 1) {
                    if ("video".equals(type)) result.restoredVideo++;
                    else result.restoredImage++;
                }
            }
            // 更新路径为当前实际路�
String oldPath = existing.getFilePath();
            if (oldPath == null || !oldPath.equals(absPath)) {
                existing.setFilePath(absPath);
                // 缩略图改用后台异步生成，不阻塞扫描
                if ("video".equals(type)) {
                    thumbnailService.enqueue(existing);
                } else {
                    existing.setThumbPath(absPath);
                }
                existing.setFileSize(file.length());
                videoMapper.updateFilePath(existing.getId(), absPath, existing.getThumbPath(), existing.getFileSize());
            }
            if (pendingClassify) {
                updatePendingForExisting(existing, title, category, folder, topCategory, commonPhrases);
            }
            return;
        }

        // 2. 全新文件
        String hashtag = pendingClassify ? generateAutoTags(title, category, folder, topCategory, commonPhrases) : null;

        Video video = new Video();
        video.setTitle(title);
        video.setFileName(fileName);
        video.setFilePath(absPath);
        video.setType(type);
        video.setCategory(null);
        video.setFileSize(file.length());
        video.setPendingHashtag(hashtag);
        video.setSource("folder");
        videoMapper.insert(video);

        // 缩略图改用后台异步生成，不阻塞扫描（视频和图片都生成缩略图）
        thumbnailService.enqueue(video);
        addImportNotification(video);

        // 加入内存索引，防止同一次扫描中重复插入
        nameTypeMap.putIfAbsent(nameKey, video);
        preScanHiddenMap.put(video.getId(), 0);

        log.info("扫描新增[{}]：{} (路径: {})", type, title, absPath);
        if ("video".equals(type)) result.newVideo++;
        else result.newImage++;
    }

    // 智能分割标签：忽略括号内的逗号
    private List<String> splitTags(String csv) {
        List<String> result = new ArrayList<>();
        if (csv == null || csv.isEmpty()) return result;
        int depth = 0;
        StringBuilder current = new StringBuilder();
        for (char c : csv.toCharArray()) {
            if (c == '(' || c == '（' || c == '[' || c == '【') {
                depth++;
                current.append(c);
            } else if (c == ')' || c == '）' || c == ']' || c == '】') {
                depth--;
                current.append(c);
            } else if (c == ',' && depth == 0) {
                String tag = current.toString().trim();
                if (!tag.isEmpty()) result.add(tag);
                current = new StringBuilder();
            } else {
                current.append(c);
            }
        }
        String last = current.toString().trim();
        if (!last.isEmpty()) result.add(last);
        return result;
    }

    // 更新已有视频的预标签
    private void updatePendingForExisting(Video v, String title, String category, File folder, String topCategory, Set<String> commonPhrases) {
        String newTags = generateAutoTags(title, category, folder, topCategory, commonPhrases);

        // 合并已有预分标签和新生成的标签（不排除已确认的标签，确保重新扫描时能包含所有匹配项）
        Set<String> merged = new LinkedHashSet<>();
        if (v.getPendingHashtag() != null && !v.getPendingHashtag().isEmpty()) {
            for (String t : splitTags(v.getPendingHashtag())) {
                merged.add(t);
            }
        }
        if (newTags != null && !newTags.isEmpty()) {
            for (String t : splitTags(newTags)) {
                merged.add(t);
            }
        }

        String result = merged.isEmpty() ? null : String.join(",", merged);
        videoMapper.updatePendingHashtag(v.getId(), result);
        if (!merged.isEmpty()) {
            addImportNotification(v);
        }
    }

    // 自动生成标签：从目录名、文件名提取
    private String generateAutoTags(String title, String category, File folder, String topCategory, Set<String> commonPhrases) {
        Set<String> tags = new LinkedHashSet<>();

        // 1. 从顶层文件夹名提取标签（用户选中的文件夹）
if (topCategory != null && !topCategory.isEmpty()) {
            String cleanTop = cleanTagName(topCategory);
            if (cleanTop != null && cleanTop.length() >= 2) {
                tags.add("#" + cleanTop);
            }
        }

        // 2. 从分类（子目录名）提取标签
if (category != null && !category.isEmpty()) {
            String cleanCategory = cleanTagName(category);
            if (cleanCategory != null && cleanCategory.length() >= 2) {
                tags.add("#" + cleanCategory);
            }
        }

        // 3. 从父目录名提取标签
if (folder != null) {
            String folderName = folder.getName();
            String cleanFolder = cleanTagName(folderName);
            if (cleanFolder != null && cleanFolder.length() >= 2 && !cleanFolder.equals(category)) {
                tags.add("#" + cleanFolder);
            }
        }

        // 4. 从文件名提取标签（优先使用共有短语）
        String[] nameTags = extractTagsFromFilename(title, commonPhrases);
        for (String tag : nameTags) {
            tags.add(tag);
        }

        return tags.isEmpty() ? null : String.join(",", tags);
    }

    // 清理标签名：去掉特殊字符，保留中文和有意义的内容
    private String cleanTagName(String name) {
        if (name == null || name.isEmpty()) return null;
        // 日期格式的文件夹名不作为标签
        if (isDateLikeName(name)) return null;
        // 先去掉括号及其内容：()、[]、（）以及其中的所有内容
        String cleaned = name.replaceAll("[\\(\\[（][^\\)\\]）]*[\\)\\]）]", " ");
        // 去掉下划线和横杠，替换为空格
        cleaned = cleaned.replaceAll("[_\\-]+", " ");
        // 去掉纯数字编号（如 "01", "001", "123"），但保留数字+中文/字母的组合（如 "5岁", "3D"）
        // 匹配：纯数字、数字开头后面是空格或结尾
        cleaned = cleaned.replaceAll("\\b\\d+\\b", " ").trim();
        // 去掉多余空格
        cleaned = cleaned.replaceAll("\\s+", " ").trim();
        if (cleaned.isEmpty() || cleaned.length() < 2) return null;
        return cleaned;
    }

    // 判断文件夹名是否像日�
private boolean isDateLikeName(String name) {
        if (name == null) return false;
        String n = name.trim();
        // 纯数字（�?20240101, 202401, 0115�
if (n.matches("\\d{4,8}")) return true;
        // 带横�?点的日期（如 2024-01-15, 2024.01.15, 2024-01, 01-15�
if (n.matches("\\d{2,4}[-.]\\d{1,2}([-.]\\d{1,2})?")) return true;
        // 带下划线的日期（�?2024_01_15, 2024_01�
if (n.matches("\\d{2,4}_\\d{1,2}(_\\d{1,2})?")) return true;
        // 中文日期（如 2024�?1�? 2024�?�?5日）
        if (n.matches("\\d{2,4}年\\d{1,2}(月|月\\d{1,2}日)?")) return true;
        // 月份名（�?January, February, Jan, Feb 等）
        String lower = n.toLowerCase();
        String[] months = {"january","february","march","april","may","june","july","august","september","october","november","december","jan","feb","mar","apr","jun","jul","aug","sep","oct","nov","dec"};
        for (String m : months) {
            if (lower.equals(m)) return true;
        }
        return false;
    }

    // 从文件名提取标签（优先使用共有短语）
    private String[] extractTagsFromFilename(String title, Set<String> commonPhrases) {
        Set<String> tags = new LinkedHashSet<>();
        String titleLower = title.toLowerCase();
        Set<String> coveredWords = new HashSet<>();

        // 1. 先匹配共有短�
if (commonPhrases != null) {
            for (String phrase : commonPhrases) {
                if (titleLower.contains(phrase)) {
                    tags.add("#" + phrase);
                    // 记录被短语覆盖的单词，后续不再单独提�
for (String w : phrase.split(" ")) {
                        coveredWords.add(w);
                    }
                }
            }
        }

        // 2. 分割文件名，提取未被短语覆盖的单�
String[] parts = title.split("[\\s_\\-,;|/\\\\]+");
        for (String part : parts) {
            part = part.trim();
            if (part.isEmpty()) continue;
            // 已有#标签
            if (part.startsWith("#")) {
                tags.add(part);
                continue;
            }
            String lower = part.toLowerCase();
            // 被短语覆盖的单词跳过
            if (coveredWords.contains(lower)) continue;
            // 中文词（2字以上）
            if (part.matches("[\\u4e00-\\u9fa5]{2,}")) {
                tags.add("#" + part);
                continue;
            }
            // 英文词（3字母以上，排除常见词�
if (part.matches("[a-zA-Z]{3,}") && !isCommonWord(lower)) {
                tags.add("#" + lower);
            }
        }
        return tags.toArray(new String[0]);
    }

    // 常见词过�
private boolean isCommonWord(String word) {
        String[] common = {"the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
                          "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
                          "how", "its", "may", "new", "now", "old", "see", "way", "who", "video",
                          "vid", "clip", "movie", "film", "recording"};
        for (String w : common) {
            if (w.equals(word)) return true;
        }
        return false;
    }

    // NSFW关键词列表（可根据需要扩展）
    private static final String[] NSFW_KEYWORDS = {
        "adult", "nsfw", "porn", "xxx", "sex", "nude", "naked", "erotic",
        "18+", "mature", "explicit", "xrated", "hentai"
    };

    // 检测是否为NSFW内容
    private boolean detectNsfw(String title, String category, File folder, String topCategory, String hashtag) {
        // 检查文件夹路径
        if (folder != null) {
            String folderPath = folder.getAbsolutePath().toLowerCase();
            for (String keyword : NSFW_KEYWORDS) {
                if (folderPath.contains(keyword)) return true;
            }
        }
        // 检查顶层分类
        if (topCategory != null) {
            String topLower = topCategory.toLowerCase();
            for (String keyword : NSFW_KEYWORDS) {
                if (topLower.contains(keyword)) return true;
            }
        }
        // 检查分类
        if (category != null) {
            String catLower = category.toLowerCase();
            for (String keyword : NSFW_KEYWORDS) {
                if (catLower.contains(keyword)) return true;
            }
        }
        // 检查标题
        if (title != null) {
            String titleLower = title.toLowerCase();
            for (String keyword : NSFW_KEYWORDS) {
                if (titleLower.contains(keyword)) return true;
            }
        }
        // 检查标签
        if (hashtag != null) {
            String tagLower = hashtag.toLowerCase();
            for (String keyword : NSFW_KEYWORDS) {
                if (tagLower.contains(keyword)) return true;
            }
        }
        return false;
    }

    // 记录导入通知
    private void addImportNotification(Video video) {
        // 存入内存列表，供前端查询
        pendingNotifications.add(new ImportNotification(video.getId(), video.getTitle(), video.getCategory()));
        // 只保留最�?00�
while (pendingNotifications.size() > 100) {
            pendingNotifications.remove(0);
        }
    }

    // 导入通知列表
    private static final List<ImportNotification> pendingNotifications = new ArrayList<>();

    public List<ImportNotification> getPendingNotifications() {
        return new ArrayList<>(pendingNotifications);
    }

    public void clearNotifications() {
        pendingNotifications.clear();
    }

    public static class ImportNotification {
        private Long videoId;
        private String title;
        private String category;
        private long timestamp;

        public ImportNotification(Long videoId, String title, String category) {
            this.videoId = videoId;
            this.title = title;
            this.category = category;
            this.timestamp = System.currentTimeMillis();
        }

        public Long getVideoId() { return videoId; }
        public String getTitle() { return title; }
        public String getCategory() { return category; }
        public long getTimestamp() { return timestamp; }
    }

    // �?ffmpeg 生成缩略�
private String generateThumbnail(File videoFile, String title) {
        // 检�?ffmpeg
        String ffmpegPath = findFfmpeg();
        if (ffmpegPath == null) return null;

        // 确保缩略图目录存�
File thumbDirFile = new File(thumbDir);
        if (!thumbDirFile.exists()) thumbDirFile.mkdirs();

        String thumbName = title + "_thumb.jpg";
        File thumbFile = new File(thumbDirFile, thumbName);

        // 如果缩略图已存在，直接返�
if (thumbFile.exists()) return thumbFile.getAbsolutePath();

        try {
            // ffmpeg -i input.mp4 -ss 00:00:01 -vframes 1 output.jpg
            ProcessBuilder pb = new ProcessBuilder(
                ffmpegPath, "-i", videoFile.getAbsolutePath(),
                "-ss", "00:00:01", "-vframes", "1",
                "-strict", "unofficial",
                "-y", thumbFile.getAbsolutePath()
            );
            pb.redirectErrorStream(true);
            Process p = pb.start();
            int exitCode = p.waitFor();
            if (exitCode == 0 && thumbFile.exists()) {
                return thumbFile.getAbsolutePath();
            }
        } catch (Exception e) {
            // 忽略错误，返�?null
        }
        return null;
    }

    private String findFfmpeg() {
        // 0. 配置文件指定的路径
        if (ffmpegPath != null && !ffmpegPath.isEmpty() && new File(ffmpegPath).exists()) {
            return new File(ffmpegPath).getAbsolutePath();
        }

        // 1. 项目 tools 目录（相对路径）
        String localPath = "tools" + File.separator + "ffmpeg.exe";
        if (new File(localPath).exists()) return localPath;

        // 查找系统 PATH
        try {
            ProcessBuilder pb = new ProcessBuilder("where", "ffmpeg");
            pb.redirectErrorStream(true);
            Process p = pb.start();
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream()));
            String line = reader.readLine();
            if (line != null && !line.isEmpty() && !line.contains("INFO")) {
                return line.trim();
            }
        } catch (Exception ignored) {}
        return null;
    }

    private String extractHashtag(String title) {
        StringBuilder tags = new StringBuilder();
        String[] parts = title.split("[\\s_\\-,;|/\\\\]+");
        for (String part : parts) {
            part = part.trim();
            if (part.isEmpty()) continue;
            if (part.startsWith("#")) {
                if (tags.length() > 0) tags.append(",");
                tags.append(part);
            } else if (part.matches("[\\u4e00-\\u9fa5]{2,}")) {
                if (tags.length() > 0) tags.append(",");
                tags.append("#" + part);
            }
        }
        return tags.length() > 0 ? tags.toString() : null;
    }

    private void markLiked(List<Video> videos, Long userId) {
        if (userId == null || videos == null) return;
        for (Video v : videos) {
            VideoLike like = videoLikeMapper.findByVideoAndUser(v.getId(), userId);
            v.setLiked(like != null);
        }
    }
}
