package com.chat.controller;

import com.chat.mapper.*;
import com.chat.model.*;
import com.chat.service.ThumbnailService;
import com.chat.service.VideoService;
import com.chat.service.ViewCountService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.*;

@RestController
@RequestMapping("/api")
public class VideoController {

    private static final Logger log = LoggerFactory.getLogger(VideoController.class);

    @Value("${chat.thumb-dir:./thumbnails}")
    private String thumbDir;

    @Value("${chat.ffmpeg-path:./tools/ffmpeg.exe}")
    private String ffmpegPath;

    @Resource
    private VideoService videoService;

    @Resource
    private ViewCountService viewCountService;

    @Resource
    private ThumbnailService thumbnailService;

    @Resource
    private VideoMapper videoMapper;

    @Resource
    private CommentMapper commentMapper;

    @Resource
    private VideoLikeMapper videoLikeMapper;

    @Resource
    private UserMapper userMapper;

    @Resource
    private DanmakuMapper danmakuMapper;

    @Resource
    private TagMapper tagMapper;



    // 调试接口
    @GetMapping("/debug/images")
    public Result<?> debugImages() {
        List<Video> all = videoMapper.findAllNoLimit();
        List<Map<String, Object>> images = new ArrayList<>();
        for (Video v : all) {
            if ("image".equals(v.getType())) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", v.getId());
                item.put("title", v.getTitle());
                item.put("fileName", v.getFileName());
                item.put("filePath", v.getFilePath());
                item.put("hidden", v.getHidden());
                images.add(item);
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalRecords", all.size());
        result.put("imageCount", images.size());
        result.put("images", images);
        return Result.ok(result);
    }

    // 视频列表
    @GetMapping("/videos")
    public Result<?> listVideos(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String category,
            @RequestAttribute(required = false) Long userId) {
        Map<String, Object> data;
        if (keyword != null && !keyword.trim().isEmpty()) {
            data = videoService.searchVideos(keyword.trim(), page, pageSize, userId);
        } else {
            data = videoService.listVideos(page, pageSize, userId, type, category);
        }
        return Result.ok(data);
    }

    // 视频详情
    @GetMapping("/videos/{id}")
    public Result<?> getVideo(@PathVariable Long id, @RequestAttribute(required = false) Long userId) {
        Video video = videoMapper.findById(id);
        if (video == null) return Result.error("视频不存在");
        if (userId != null) {
            VideoLike like = videoLikeMapper.findByVideoAndUser(id, userId);
            video.setLiked(like != null);
        }
        return Result.ok(video);
    }

    // 分类列表
    @GetMapping("/categories")
    public Result<?> getCategories() {
        return Result.ok(videoService.getCategories());
    }

    // 点赞
    @PostMapping("/videos/{id}/like")
    public Result<?> toggleLike(@PathVariable Long id, @RequestAttribute Long userId) {
        boolean liked = videoService.toggleLike(id, userId);
        return Result.ok(liked ? "已点赞" : "已取消点赞");
    }



    // 点赞列表
    @GetMapping("/likes")
    public Result<?> getLikedVideos(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String category,
            @RequestAttribute Long userId) {
        int offset = (page - 1) * pageSize;
        boolean hasFilter = (keyword != null && !keyword.isEmpty()) || (type != null && !type.isEmpty()) || (category != null && !category.isEmpty());
        List<Video> videos;
        int total;
        if (hasFilter) {
            videos = videoLikeMapper.findLikedVideosByUserWithFilter(userId, offset, pageSize, keyword, type, category);
            total = videoLikeMapper.countLikedVideosByUserWithFilter(userId, keyword, type, category);
        } else {
            videos = videoLikeMapper.findLikedVideosByUser(userId, offset, pageSize);
            total = videoLikeMapper.countLikedVideosByUser(userId);
        }
        for (Video v : videos) {
            v.setLiked(true);
            if (v.getFilePath() != null && !new File(v.getFilePath()).exists()) {
                v.setTitle("[已删除] " + v.getTitle());
            }
        }
        Map<String, Object> result = new HashMap<>();
        result.put("list", videos);
        result.put("total", total);
        result.put("page", page);
        result.put("pageSize", pageSize);
        result.put("totalPages", Math.max(1, (total + pageSize - 1) / pageSize));
        return Result.ok(result);
    }

    // 增加浏览量
    @PostMapping("/videos/{id}/view")
    public Result<?> incrementView(@PathVariable Long id) {
        viewCountService.incrementView(id);
        return Result.ok("ok");
    }

    // 删除视频（删除原文件+数据库记录+关联数据）
    @DeleteMapping("/videos/{id}")
    public Result<?> deleteVideo(@PathVariable Long id) {
        Video video = videoMapper.findById(id);
        if (video == null) return Result.error("视频不存在");
        // 删除原文件
        if (video.getFilePath() != null) {
            File file = new File(video.getFilePath());
            if (file.exists()) file.delete();
        }
        // 删除缩略图
        if (video.getThumbUrl() != null) {
            String thumbPath = video.getThumbUrl();
            if (thumbPath.startsWith("/thumbnails/")) {
                File thumb = new File("thumbnails" + thumbPath.substring("/thumbnails/".length()));
                if (thumb.exists()) thumb.delete();
            }
        }
        // 删除关联数据
        videoLikeMapper.deleteByVideoIds(java.util.Collections.singletonList(id));
        commentMapper.deleteByVideoIds(java.util.Collections.singletonList(id));
        videoMapper.deleteById(id);
        return Result.ok("删除成功");
    }

    // 重命名视频文件
    @PostMapping("/videos/{id}/rename")
    public Result<?> renameVideo(@PathVariable Long id, @RequestBody Map<String, String> body) {
        String newName = body.get("newName");
        if (newName == null || newName.trim().isEmpty()) return Result.error("文件名不能为空");
        Video video = videoMapper.findById(id);
        if (video == null) return Result.error("视频不存在");
        File oldFile = new File(video.getFilePath());
        if (!oldFile.exists()) return Result.error("原文件不存在");
        // 保留原扩展名
        String oldName = oldFile.getName();
        String ext = "";
        int dotIdx = oldName.lastIndexOf('.');
        if (dotIdx > 0) ext = oldName.substring(dotIdx);
        String newFileName = newName.trim() + ext;
        File newFile = new File(oldFile.getParent(), newFileName);
        if (newFile.exists()) return Result.error("同名文件已存在");
        if (!oldFile.renameTo(newFile)) return Result.error("重命名失败");
        // 更新数据库
        videoMapper.updateFilePathOnly(id, newFile.getAbsolutePath());
        videoMapper.updateTitle(id, newName.trim());
        return Result.ok("重命名成功");
    }

    // 刷新视频封面（截取指定位置的帧）
    @PostMapping("/videos/{id}/refresh-thumb")
    public Result<?> refreshThumbnail(@PathVariable Long id, @RequestBody Map<String, String> body) {
        Integer percent = 25;
        String percentStr = body.get("percent");
        if (percentStr != null) {
            try { percent = Integer.parseInt(percentStr); } catch (Exception ignored) {}
        }

        Video video = videoMapper.findById(id);
        if (video == null) return Result.error("视频不存在");
        if (video.getFilePath() == null) return Result.error("文件路径不存在");
        File videoFile = new File(video.getFilePath());
        if (!videoFile.exists()) return Result.error("视频文件不存在");
        if (percent < -1) percent = -1;
        if (percent > 100) percent = 100;

        // percent=-1 表示使用智能截取（跳过黑帧）
        if (percent == -1) {
            File ffmpegFile = new File(ffmpegPath);
            if (!ffmpegFile.exists()) return Result.error("ffmpeg不存在: " + ffmpegPath);
            String oldThumbPath = video.getThumbUrl();
            String newThumbPath = thumbnailService.generateSync(videoFile, video.getTitle());
            if (newThumbPath == null) return Result.error("智能截取失败");
            // 删除旧缩略图
            if (oldThumbPath != null && oldThumbPath.startsWith("/thumbnails/")) {
                File oldThumb = new File(thumbDir + oldThumbPath.substring("/thumbnails/".length()));
                if (oldThumb.exists()) oldThumb.delete();
            }
            videoMapper.updateThumbUrl(id, newThumbPath);
            Map<String, Object> result = new HashMap<>();
            result.put("thumbUrl", "/api/stream/thumb/" + id);
            return Result.ok(result);
        }

        // 获取视频时长和检测是否有视频流（用ffmpeg代替ffprobe）
        long durationSec = 0;
        File ffmpegFile = new File(ffmpegPath);
        String ffmpegAbsPath = ffmpegFile.getAbsolutePath();
        try {
            // 用ffmpeg -i 获取视频信息（输出到stderr）
            ProcessBuilder infoPb = new ProcessBuilder(ffmpegAbsPath, "-i", videoFile.getAbsolutePath());
            infoPb.redirectErrorStream(true);
            Process infoProc = infoPb.start();
            java.io.BufferedReader infoReader = new java.io.BufferedReader(new java.io.InputStreamReader(infoProc.getInputStream()));
            String infoLine;
            boolean hasVideo = false;
            while ((infoLine = infoReader.readLine()) != null) {
                if (infoLine.contains("Video:")) hasVideo = true;
                if (infoLine.contains("Duration:")) {
                    int idx = infoLine.indexOf("Duration:");
                    if (idx >= 0) {
                        String durStr = infoLine.substring(idx + 10, idx + 18).trim();
                        String[] parts = durStr.split(":");
                        if (parts.length >= 3) {
                            durationSec = Math.round(Integer.parseInt(parts[0]) * 3600 + Integer.parseInt(parts[1]) * 60 + Double.parseDouble(parts[2]));
                        }
                    }
                }
            }
            infoProc.waitFor();
            if (!hasVideo) {
                return Result.error("该文件没有视频流，无法截取封面");
            }
        } catch (Exception e) {
            durationSec = 30;
        }

        long seekSec = durationSec * percent / 100;

        // 生成缩略图
        File thumbDirFile = new File(thumbDir);
        if (!thumbDirFile.exists()) thumbDirFile.mkdirs();
        String thumbName = "thumb_" + id + "_" + System.currentTimeMillis() + ".jpg";
        String thumbPath = thumbDirFile.getAbsolutePath() + File.separator + thumbName;

        try {
            ProcessBuilder pb = new ProcessBuilder(
                ffmpegFile.getAbsolutePath(), "-y", "-ss", String.valueOf(seekSec), "-i", videoFile.getAbsolutePath(),
                "-vframes", "1", "-q:v", "2", "-strict", "unofficial", thumbPath
            );
            pb.redirectErrorStream(true);
            Process p = pb.start();
            java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream()));
            StringBuilder ffmpegOutput = new StringBuilder();
            String l;
            while ((l = br.readLine()) != null) ffmpegOutput.append(l).append("\n");
            p.waitFor();
            if (p.exitValue() != 0) {
                log.error("ffmpeg截取失败: {}", ffmpegOutput);
                return Result.error("ffmpeg截取失败: " + ffmpegOutput.toString().substring(0, Math.min(200, ffmpegOutput.length())));
            }
        } catch (Exception e) {
            log.error("ffmpeg执行异常", e);
            return Result.error("截取失败: " + e.getMessage());
        }

        File thumbFile = new File(thumbPath);
        if (!thumbFile.exists() || thumbFile.length() == 0) {
            return Result.error("截取失败，未生成缩略图");
        }

        // 删除旧缩略图
        if (video.getThumbUrl() != null && video.getThumbUrl().startsWith("/thumbnails/")) {
            String oldThumbPath = thumbDirFile.getAbsolutePath() + video.getThumbUrl().substring("/thumbnails/".length());
            File oldThumb = new File(oldThumbPath);
            if (oldThumb.exists()) oldThumb.delete();
        }

        // 更新数据库（存文件路径）
        videoMapper.updateThumbUrl(id, thumbPath);

        // 返回给前端的是可访问的URL
        String thumbUrl = "/api/stream/thumb/" + id;

        Map<String, Object> result = new HashMap<>();
        result.put("thumbUrl", thumbUrl);
        return Result.ok(result);
    }

    // 评论列表
    @GetMapping("/videos/{id}/comments")
    public Result<?> getComments(
            @PathVariable Long id,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        int offset = (page - 1) * pageSize;
        List<Comment> comments = commentMapper.findByVideoId(id, offset, pageSize);
        int total = commentMapper.countByVideoId(id);
        Map<String, Object> result = new HashMap<>();
        result.put("list", comments);
        result.put("total", total);
        return Result.ok(result);
    }

    // 添加评论
    @PostMapping("/videos/{id}/comments")
    public Result<?> addComment(@PathVariable Long id, @RequestBody Map<String, String> body, @RequestAttribute Long userId) {
        String content = body.get("content");
        if (content == null || content.trim().isEmpty()) {
            return Result.error("评论内容不能为空");
        }
        Comment comment = new Comment();
        comment.setVideoId(id);
        comment.setUserId(userId);
        comment.setContent(content.trim());
        commentMapper.insert(comment);
        videoMapper.updateCommentCount(id, 1);
        return Result.ok(comment);
    }

    // 删除评论
    @DeleteMapping("/comments/{id}")
    public Result<?> deleteComment(@PathVariable Long id, @RequestAttribute Long userId) {
        commentMapper.deleteById(id);
        return Result.ok("已删除");
    }

    // 获取弹幕列表
    @GetMapping("/videos/{id}/danmaku")
    public Result<?> getDanmaku(@PathVariable Long id) {
        List<Danmaku> list = danmakuMapper.findByVideoId(id);
        return Result.ok(list);
    }

    // 发送弹幕
    @PostMapping("/videos/{id}/danmaku")
    public Result<?> addDanmaku(@PathVariable Long id, @RequestBody Map<String, Object> body, @RequestAttribute Long userId) {
        String content = (String) body.get("content");
        if (content == null || content.trim().isEmpty()) return Result.error("弹幕内容不能为空");
        Number timePoint = (Number) body.getOrDefault("timePoint", 0);
        String color = (String) body.getOrDefault("color", "#ffffff");
        Danmaku d = new Danmaku();
        d.setVideoId(id);
        d.setUserId(userId);
        d.setContent(content.trim());
        d.setTimePoint(timePoint.floatValue());
        d.setColor(color);
        danmakuMapper.insert(d);
        return Result.ok(d);
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

    // === 标签管理 ===
    @GetMapping("/tags/manage")
    public Result<?> manageTags() {
        List<Video> allVideos = videoMapper.findAllNoLimit();
        // tag -> [videoCount, imageCount]
        Map<String, int[]> tagStats = new LinkedHashMap<>();
        for (Video v : allVideos) {
            if (v.getHashtag() == null || v.getHashtag().isEmpty()) continue;
            for (String tag : splitTags(v.getHashtag())) {
                int[] stats = tagStats.computeIfAbsent(tag, k -> new int[2]);
                if ("image".equals(v.getType())) stats[1]++;
                else stats[0]++;
            }
        }
        List<Map<String, Object>> result = new ArrayList<>();
        tagStats.forEach((name, stats) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", name);
            item.put("videoCount", stats[0]);
            item.put("imageCount", stats[1]);
            item.put("count", stats[0] + stats[1]);
            result.add(item);
        });
        return Result.ok(result);
    }

    @PostMapping("/tags/rename")
    public Result<?> renameTag(@RequestBody Map<String, String> body) {
        String oldName = body.get("oldName");
        String newName = body.get("newName");
        if (oldName == null || newName == null || oldName.isEmpty() || newName.isEmpty()) {
            return Result.error("标签名不能为空");
        }
        videoMapper.renameTag(oldName, newName);
        tagMapper.rename(oldName, newName);
        return Result.ok("已重命名");
    }

    @DeleteMapping("/tags/{tag}")
    public Result<?> deleteTag(@PathVariable String tag) {
        videoMapper.removeTag(tag);
        tagMapper.deleteByName(tag);
        return Result.ok("已删除");
    }

    // 所有标签
    @GetMapping("/tags")
    public Result<?> getAllTags() {
        List<String> rawTags = videoMapper.findAllTags();
        Map<String, Integer> tagCount = new HashMap<>();
        for (String tagStr : rawTags) {
            for (String tag : splitTags(tagStr)) {
                tagCount.put(tag, tagCount.getOrDefault(tag, 0) + 1);
            }
        }
        List<Map<String, Object>> result = new ArrayList<>();
        tagCount.forEach((tag, count) -> {
            Map<String, Object> item = new HashMap<>();
            item.put("name", tag);
            item.put("count", count);
            result.add(item);
        });
        result.sort((a, b) -> Integer.compare((int) b.get("count"), (int) a.get("count")));
        return Result.ok(result);
    }

    // 搜索标签
    @GetMapping("/tags/search")
    public Result<?> searchTags(@RequestParam String q) {
        List<String> rawTags = videoMapper.findAllTags();
        Map<String, Integer> tagCount = new HashMap<>();
        for (String tagStr : rawTags) {
            for (String tag : splitTags(tagStr)) {
                if (tag.toLowerCase().contains(q.toLowerCase())) {
                    tagCount.put(tag, tagCount.getOrDefault(tag, 0) + 1);
                }
            }
        }
        List<Map<String, Object>> result = new ArrayList<>();
        tagCount.forEach((tag, count) -> {
            Map<String, Object> item = new HashMap<>();
            item.put("name", tag);
            item.put("count", count);
            result.add(item);
        });
        result.sort((a, b) -> Integer.compare((int) b.get("count"), (int) a.get("count")));
        return Result.ok(result);
    }

    // 添加标签
    @PostMapping("/videos/{id}/tags")
    public Result<?> addTag(@PathVariable Long id, @RequestBody Map<String, String> body) {
        String tag = body.get("tag");
        if (tag == null || tag.trim().isEmpty()) {
            return Result.error("标签不能为空");
        }
        tag = tag.trim();
        if (!tag.startsWith("#")) tag = "#" + tag;

        Video video = videoMapper.findById(id);
        if (video == null) return Result.error("视频不存在");

        String existing = video.getHashtag();
        if (existing != null && !existing.isEmpty()) {
            for (String t : splitTags(existing)) {
                if (t.equals(tag)) {
                    return Result.error("标签已存在");
                }
            }
            videoMapper.updateHashtag(id, existing + "," + tag);
        } else {
            videoMapper.updateHashtag(id, tag);
        }
        return Result.ok("添加成功");
    }

    // 删除标签
    @DeleteMapping("/videos/{videoId}/tags")
    public Result<?> deleteTag(@PathVariable Long videoId, @RequestParam String tag) {
        Video video = videoMapper.findById(videoId);
        if (video == null) return Result.error("视频不存在");

        String existing = video.getHashtag();
        if (existing == null || existing.isEmpty()) {
            return Result.error("标签不存在");
        }
        List<String> newTags = new ArrayList<>();
        for (String t : splitTags(existing)) {
            if (!t.equals(tag)) {
                newTags.add(t);
            }
        }
        videoMapper.updateHashtag(videoId, newTags.isEmpty() ? null : String.join(",", newTags));
        return Result.ok("已删除");
    }

    // 获取某个标签下的视频
    @GetMapping("/tags/{tag}/videos")
    public Result<?> getTagVideos(@PathVariable String tag,
                                  @RequestParam(defaultValue = "1") int page,
                                  @RequestParam(defaultValue = "50") int pageSize) {
        int offset = (page - 1) * pageSize;
        List<Video> allVideos = videoMapper.findAllNoLimit();
        List<Video> matched = new ArrayList<>();
        for (Video v : allVideos) {
            if (v.getHashtag() != null && !v.getHashtag().isEmpty()) {
                for (String t : splitTags(v.getHashtag())) {
                    if (t.equalsIgnoreCase(tag)) {
                        matched.add(v);
                        break;
                    }
                }
            }
        }
        int total = matched.size();
        List<Video> paged = matched.subList(Math.min(offset, total), Math.min(offset + pageSize, total));

        Map<String, Object> data = new HashMap<>();
        data.put("list", paged);
        data.put("total", total);
        data.put("page", page);
        data.put("totalPages", (total + pageSize - 1) / pageSize);
        return Result.ok(data);
    }

    // === 标签元数据 API ===

    // 获取标签元数据
    @GetMapping("/tags/{tag}/meta")
    public Result<?> getTagMeta(@PathVariable String tag) {
        Tag tagObj = tagMapper.findByName(tag);
        if (tagObj == null) {
            tagObj = new Tag();
            tagObj.setName(tag);
            tagMapper.insert(tagObj);
        }
        // 修复失效的封面引用
        fixStaleCover(tagObj);
        return Result.ok(tagObj);
    }

    // 设置标签封面
    @PutMapping("/tags/{tag}/cover")
    public Result<?> setTagCover(@PathVariable String tag, @RequestBody Map<String, Object> body) {
        Tag tagObj = tagMapper.findByName(tag);
        if (tagObj == null) return Result.error("标签不存在");

        Long videoId = body.get("videoId") != null ? Long.valueOf(body.get("videoId").toString()) : null;
        String imagePath = (String) body.get("imagePath");

        tagMapper.updateCover(tagObj.getId(), videoId, imagePath);
        return Result.ok("封面已更新");
    }

    // 设置标签简介
    @PutMapping("/tags/{tag}/description")
    public Result<?> setTagDescription(@PathVariable String tag, @RequestBody Map<String, String> body) {
        Tag tagObj = tagMapper.findByName(tag);
        if (tagObj == null) return Result.error("标签不存在");

        tagMapper.updateDescription(tagObj.getId(), body.get("description"));
        return Result.ok("简介已更新");
    }

    // 给标签添加视频
    @PostMapping("/tags/{tag}/videos")
    public Result<?> addVideoToTag(@PathVariable String tag, @RequestBody Map<String, Long> body) {
        Long videoId = body.get("videoId");
        if (videoId == null) return Result.error("视频ID不能为空");
        Video video = videoMapper.findById(videoId);
        if (video == null) return Result.error("视频不存在");

        String existing = video.getHashtag();
        if (existing != null && !existing.isEmpty()) {
            for (String t : splitTags(existing)) {
                if (t.equalsIgnoreCase(tag)) return Result.error("标签已存在");
            }
            videoMapper.updateHashtag(videoId, existing + "," + tag);
        } else {
            videoMapper.updateHashtag(videoId, tag);
        }
        return Result.ok("已添加");
    }

    // 从标签移除视频
    @DeleteMapping("/tags/{tag}/videos/{videoId}")
    public Result<?> removeVideoFromTag(@PathVariable String tag, @PathVariable Long videoId) {
        Video video = videoMapper.findById(videoId);
        if (video == null) return Result.error("视频不存在");

        String existing = video.getHashtag();
        if (existing == null || existing.isEmpty()) return Result.error("标签不存在");

        List<String> newTags = new ArrayList<>();
        for (String t : splitTags(existing)) {
            if (!t.equalsIgnoreCase(tag)) newTags.add(t);
        }
        videoMapper.updateHashtag(videoId, newTags.isEmpty() ? null : String.join(",", newTags));
        return Result.ok("已移除");
    }

    // 浏览服务器目录
    @GetMapping("/browse")
    public Result<?> browseDirectory(@RequestParam(defaultValue = "") String path) {
        File dir;
        if (path.isEmpty()) {
            File[] roots = File.listRoots();
            List<Map<String, Object>> list = new ArrayList<>();
            for (File root : roots) {
                Map<String, Object> item = new HashMap<>();
                item.put("name", root.getAbsolutePath());
                item.put("path", root.getAbsolutePath());
                item.put("isDir", true);
                list.add(item);
            }
            Map<String, Object> result = new HashMap<>();
            result.put("current", "");
            result.put("parent", null);
            result.put("items", list);
            return Result.ok(result);
        }

        dir = new File(path);
        if (!dir.exists() || !dir.isDirectory()) {
            return Result.error("目录不存在");
        }

        File[] files = dir.listFiles();
        List<Map<String, Object>> list = new ArrayList<>();
        if (files != null) {
            for (File f : files) {
                if (!f.isDirectory()) continue;
                if (f.getName().startsWith(".")) continue;
                Map<String, Object> item = new HashMap<>();
                item.put("name", f.getName());
                item.put("path", f.getAbsolutePath());
                item.put("isDir", true);
                list.add(item);
            }
        }
        list.sort((a, b) -> ((String) a.get("name")).compareToIgnoreCase((String) b.get("name")));

        Map<String, Object> result = new HashMap<>();
        result.put("current", dir.getAbsolutePath());
        result.put("parent", dir.getParent());
        result.put("items", list);
        return Result.ok(result);
    }

    // 文件夹管理
    @GetMapping("/folders")
    public Result<?> listFolders() {
        return Result.ok(videoService.listFolders());
    }

    @PostMapping("/folders")
    public Result<?> addFolder(@RequestBody Map<String, String> body) {
        String path = body.get("path");
        if (path == null || path.trim().isEmpty()) {
            return Result.error("文件夹路径不能为空");
        }
        MediaFolder folder = videoService.addFolder(path.trim());
        if (folder == null) {
            return Result.error("文件夹不存在");
        }
        return Result.ok(folder);
    }

    @DeleteMapping("/folders/{id}")
    public Result<?> deleteFolder(@PathVariable Long id,
                                  @RequestParam(defaultValue = "false") boolean deleteData) {
        log.info("用户操作：删除文件夹 id={}, deleteData={}", id, deleteData);
        String msg = videoService.deleteFolder(id, deleteData);
        log.info("删除结果：{}", msg);
        return msg != null ? Result.ok(msg) : Result.error("删除失败");
    }

    @PostMapping("/folders/{id}/scan")
    public Result<?> scanFolder(@PathVariable Long id,
                                @RequestParam(defaultValue = "true") boolean video,
                                @RequestParam(defaultValue = "false") boolean image,
                                @RequestParam(defaultValue = "false") boolean pendingClassify) {
        log.info("用户操作：扫描文件夹 id={}, video={}, image={}, pendingClassify={}", id, video, image, pendingClassify);
        VideoService.ScanResult result = videoService.scanFolder(id, video, image, pendingClassify);
        log.info("扫描结果：{}", result.toMessage());
        return Result.ok(result.toMessage());
    }

    @PostMapping("/folders/scan-all")
    public Result<?> scanAllFolders(@RequestBody Map<String, Object> body) {
        List<Map<String, Object>> folders = (List<Map<String, Object>>) body.get("folders");
        if (folders == null || folders.isEmpty()) return Result.ok("无变化");
        boolean pendingClassify = Boolean.TRUE.equals(body.get("pendingClassify"));

        List<VideoService.FolderScanConfig> configs = new ArrayList<>();
        for (Map<String, Object> fc : folders) {
            VideoService.FolderScanConfig config = new VideoService.FolderScanConfig();
            config.folderId = Long.valueOf(fc.get("id").toString());
            config.scanVideo = Boolean.TRUE.equals(fc.get("video"));
            config.scanImage = Boolean.TRUE.equals(fc.get("image"));
            config.pendingClassify = pendingClassify;
            configs.add(config);
        }

        log.info("用户操作：扫描全部, 共{}个文件夹, pendingClassify={}", configs.size(), pendingClassify);
        VideoService.ScanResult result = videoService.scanAllFoldersShared(configs);
        log.info("扫描全部结果：{}", result.toMessage());
        return Result.ok(result.toMessage());
    }

    // 导入通知
    @GetMapping("/notifications")
    public Result<?> getNotifications() {
        return Result.ok(videoService.getPendingNotifications());
    }

    @PostMapping("/notifications/clear")
    public Result<?> clearNotifications() {
        videoService.clearNotifications();
        return Result.ok("已清空");
    }

    // 预分标签管理
    @GetMapping("/pending-tags")
    public Result<?> getPendingTags() {
        // 只加载有待分标签的视频，而不是全部视频
        List<Video> pendingVideos = videoMapper.findAutoTagged(0, Integer.MAX_VALUE);
        Map<String, int[]> tagStats = new LinkedHashMap<>(); // [videoCount, imageCount]
        Map<String, Set<String>> tagFolders = new LinkedHashMap<>();
        for (Video v : pendingVideos) {
            // 获取该视频已确认的标签集合
            Set<String> confirmedTags = new HashSet<>();
            if (v.getHashtag() != null && !v.getHashtag().isEmpty()) {
                for (String t : splitTags(v.getHashtag())) {
                    confirmedTags.add(t.toLowerCase());
                }
            }

            String folder = "未知文件夹";
            if (v.getFilePath() != null) {
                File f = new File(v.getFilePath());
                if (f.getParent() != null) folder = f.getParent();
            }
            for (String tag : splitTags(v.getPendingHashtag())) {
                // 跳过已确认的标签，只统计真正待处理的
                if (confirmedTags.contains(tag.toLowerCase())) continue;
                int[] stats = tagStats.computeIfAbsent(tag, k -> new int[2]);
                if ("image".equals(v.getType())) stats[1]++;
                else stats[0]++;
                tagFolders.computeIfAbsent(tag, k -> new LinkedHashSet<>()).add(folder);
            }
        }

        // 获取系统中已存在的标签集合
        Set<String> existingTags = new HashSet<>();
        List<String> rawTags = videoMapper.findAllTags();
        for (String tagStr : rawTags) {
            for (String t : splitTags(tagStr)) {
                existingTags.add(t.toLowerCase());
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        tagStats.forEach((tag, stats) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", tag);
            item.put("videoCount", stats[0]);
            item.put("imageCount", stats[1]);
            item.put("count", stats[0] + stats[1]);
            Set<String> folders = tagFolders.get(tag);
            item.put("folderCount", folders != null ? folders.size() : 0);
            // 标记该标签是否已存在于系统中
            item.put("existsInSystem", existingTags.contains(tag.toLowerCase()));
            result.add(item);
        });
        result.sort((a, b) -> Integer.compare((int) b.get("count"), (int) a.get("count")));
        return Result.ok(result);
    }

    @GetMapping("/pending-tags/{tag}/videos")
    public Result<?> getPendingTagVideos(@PathVariable String tag,
                                         @RequestParam(defaultValue = "100") int pageSize) {
        // 只查询包含该标签的视频，而不是加载全部视频
        List<Video> matched = videoMapper.findByPendingTag(tag, 0, 10000);

        // 过滤掉该标签已确认的视频（避免重复显示）
        List<Video> filtered = new ArrayList<>();
        String tagLower = tag.toLowerCase();
        for (Video v : matched) {
            boolean alreadyConfirmed = false;
            if (v.getHashtag() != null && !v.getHashtag().isEmpty()) {
                for (String t : splitTags(v.getHashtag())) {
                    if (t.toLowerCase().equals(tagLower)) {
                        alreadyConfirmed = true;
                        break;
                    }
                }
            }
            if (!alreadyConfirmed) {
                filtered.add(v);
            }
        }

        // 按文件夹分组
        Map<String, List<Video>> folderMap = new LinkedHashMap<>();
        for (Video v : filtered) {
            String folderPath = "未知文件夹";
            if (v.getFilePath() != null) {
                File f = new File(v.getFilePath());
                if (f.getParent() != null) folderPath = f.getParent();
            }
            folderMap.computeIfAbsent(folderPath, k -> new ArrayList<>()).add(v);
        }

        // 分为视频和图片
        List<Map<String, Object>> videoGroups = new ArrayList<>();
        List<Map<String, Object>> imageGroups = new ArrayList<>();
        folderMap.forEach((folder, vids) -> {
            List<Video> videos = new ArrayList<>();
            List<Video> images = new ArrayList<>();
            for (Video v : vids) {
                if ("image".equals(v.getType())) images.add(v);
                else videos.add(v);
            }
            if (!videos.isEmpty()) {
                Map<String, Object> g = new LinkedHashMap<>();
                g.put("folder", folder);
                g.put("videos", videos);
                videoGroups.add(g);
            }
            if (!images.isEmpty()) {
                Map<String, Object> g = new LinkedHashMap<>();
                g.put("folder", folder);
                g.put("videos", images);
                imageGroups.add(g);
            }
        });

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("videoGroups", videoGroups);
        data.put("imageGroups", imageGroups);
        data.put("videoTotal", filtered.stream().filter(v -> !"image".equals(v.getType())).count());
        data.put("imageTotal", filtered.stream().filter(v -> "image".equals(v.getType())).count());
        return Result.ok(data);
    }

    @PostMapping("/videos/{id}/confirm-tag")
    public Result<?> confirmPendingTag(@PathVariable Long id, @RequestBody Map<String, String> body) {
        String tag = body.get("tag").trim();
        videoMapper.confirmPendingTag(id, tag);

        // 如果标签还没有封面，用当前视频设置封面
        Tag tagObj = tagMapper.findByName(tag);
        if (tagObj == null) {
            tagObj = new Tag();
            tagObj.setName(tag);
            tagMapper.insert(tagObj);
        }
        if (tagObj.getCoverVideoId() == null && tagObj.getCoverImagePath() == null) {
            Video video = videoMapper.findById(id);
            if (video != null) {
                if (video.getThumbPath() == null || !new File(video.getThumbPath()).exists()) {
                    File mediaFile = new File(video.getFilePath());
                    if (mediaFile.exists()) {
                        String thumbPath = thumbnailService.generateSync(mediaFile, video.getTitle());
                        if (thumbPath != null) {
                            video.setThumbPath(thumbPath);
                            videoMapper.updateFilePath(video.getId(), video.getFilePath(), thumbPath, video.getFileSize());
                        } else {
                            log.warn("confirm-tag: thumbnail generation failed for video {}, skipping cover", id);
                        }
                    } else {
                        log.warn("confirm-tag: media file not found: {}", video.getFilePath());
                    }
                }
                // 只在缩略图确实存在时才设置封面
                if (video.getThumbPath() != null && new File(video.getThumbPath()).exists()) {
                    tagMapper.updateCover(tagObj.getId(), video.getId(), null);
                }
            }
        }

        return Result.ok("已确认");
    }

    @PostMapping("/videos/{id}/reject-tag")
    public Result<?> rejectPendingTag(@PathVariable Long id, @RequestBody Map<String, String> body) {
        String tag = body.get("tag");
        videoMapper.rejectPendingTag(id, tag.trim());
        return Result.ok("已拒绝");
    }

    @PostMapping("/pending-tags/{tag}/confirm-all")
    public Result<?> confirmAllTag(@PathVariable String tag) {
        String tagName = tag.trim();
        List<Video> videos = videoMapper.findByPendingTag(tagName, 0, 10000);
        for (Video v : videos) {
            videoMapper.confirmPendingTag(v.getId(), tagName);
        }

        // 设置标签封面：先确保第一个视频/图片有缩略图
        if (!videos.isEmpty()) {
            Video first = videos.get(0);
            // 标签可能不存在，需要自动创建
            Tag tagObj = tagMapper.findByName(tagName);
            if (tagObj == null) {
                tagObj = new Tag();
                tagObj.setName(tagName);
                tagMapper.insert(tagObj);
            }
            // 只在标签没有封面时设置
            if (tagObj.getCoverVideoId() == null && tagObj.getCoverImagePath() == null) {
                // 确保第一个文件有缩略图（视频和图片都走这个逻辑）
                if (first.getThumbPath() == null || !new File(first.getThumbPath()).exists()) {
                    File mediaFile = new File(first.getFilePath());
                    if (mediaFile.exists()) {
                        String thumbPath = thumbnailService.generateSync(mediaFile, first.getTitle());
                        if (thumbPath != null) {
                            first.setThumbPath(thumbPath);
                            videoMapper.updateFilePath(first.getId(), first.getFilePath(), thumbPath, first.getFileSize());
                        } else {
                            log.warn("confirm-all: thumbnail generation failed for video {}", first.getId());
                        }
                    } else {
                        log.warn("confirm-all: media file not found: {}", first.getFilePath());
                    }
                }
                // 只在缩略图确实存在时才设置封面
                if (first.getThumbPath() != null && new File(first.getThumbPath()).exists()) {
                    tagMapper.updateCover(tagObj.getId(), first.getId(), null);
                }
            }
        }

        return Result.ok("已确认" + videos.size() + "个视频");
    }

    @PostMapping("/pending-tags/{oldTag}/rename")
    public Result<?> renamePendingTag(@PathVariable String oldTag, @RequestBody Map<String, String> body) {
        String newTag = body.get("newTag");
        videoMapper.renamePendingTag(oldTag, newTag);
        return Result.ok("已重命名");
    }

    @PostMapping("/pending-tags/clear-all")
    public Result<?> clearAllPendingTags() {
        videoMapper.clearAllPendingHashtag();
        return Result.ok("已清空所有预分标签");
    }

    @PostMapping("/pending-tags/{tag}/reject-all")
    public Result<?> rejectAllTag(@PathVariable String tag) {
        List<Video> videos = videoMapper.findByPendingTag(tag, 0, 10000);
        for (Video v : videos) {
            videoMapper.rejectPendingTag(v.getId(), tag);
        }
        return Result.ok("已拒绝" + videos.size() + "个视频");
    }

    // === 缩略图管理 ===
    @GetMapping("/thumbnail/stats")
    public Result<?> thumbnailStats() {
        return Result.ok(thumbnailService.getStats());
    }

    @PostMapping("/thumbnail/clean")
    public Result<?> cleanThumbnails() {
        int orphans = thumbnailService.cleanOrphans();
        int evicted = thumbnailService.enforceLimit();
        return Result.ok("清理孤立缩略图 " + orphans + " 个，淘汰超限缩略图 " + evicted + " 个");
    }

    @PostMapping("/thumbnail/generate/{id}")
    public Result<?> generateThumbnail(@PathVariable Long id) {
        Video video = videoMapper.findById(id);
        if (video == null) return Result.error("视频不存在");
        if (thumbnailService.hasThumbnail(video)) return Result.ok("缩略图已存在");
        thumbnailService.enqueue(video);
        return Result.ok("已加入生成队列");
    }

    // 文件流
    @GetMapping("/stream/video/{id}")
    public void streamVideo(@PathVariable Long id, HttpServletRequest request, HttpServletResponse response) throws IOException {
        Video video = videoMapper.findById(id);
        if (video == null || video.getFilePath() == null) {
            response.setStatus(404);
            return;
        }

        File file = new File(video.getFilePath());
        if (!file.exists()) {
            response.setStatus(404);
            return;
        }
        streamFile(file, request, response, "video");
    }

    @GetMapping("/stream/thumb/{id}")
    public void streamThumb(@PathVariable Long id, HttpServletRequest request, HttpServletResponse response) throws IOException {
        Video video = videoMapper.findById(id);
        if (video == null) {
            log.warn("Thumbnail request: video {} not found in DB", id);
            response.setStatus(404);
            return;
        }

        String thumbPath = video.getThumbPath();

        // 检查是否需要生成缩略图：不存在、或指向原图（非thumbnails目录）
        boolean needGenerate = false;
        if (thumbPath == null || thumbPath.isEmpty()) {
            needGenerate = true;
        } else {
            File thumbFile = new File(thumbPath);
            if (!thumbFile.exists()) {
                needGenerate = true;
            } else if (video.getFilePath() != null && thumbPath.equals(video.getFilePath())) {
                // 图片类型的thumbPath指向原图，需要生成真正的缩略图
                needGenerate = true;
            }
        }

        if (needGenerate) {
            log.info("Thumbnail missing for video {} (path={}), regenerating...", id, thumbPath);
            if (video.getFilePath() == null) {
                log.warn("Thumbnail gen failed: file_path is null for video {}", id);
                response.setStatus(404);
                return;
            }
            File videoFile = new File(video.getFilePath());
            if (!videoFile.exists()) {
                log.warn("Thumbnail gen failed: source file not found: {}", video.getFilePath());
                response.setStatus(404);
                return;
            }
            String newThumbPath = thumbnailService.generateSync(videoFile, video.getTitle());
            if (newThumbPath != null) {
                video.setThumbPath(newThumbPath);
                videoMapper.updateFilePath(video.getId(), video.getFilePath(), newThumbPath, video.getFileSize());
                thumbPath = newThumbPath;
                log.info("Thumbnail regenerated for video {}: {}", id, newThumbPath);
            } else {
                log.warn("Thumbnail generation returned null for video {}", id);
                response.setStatus(404);
                return;
            }
        }

        File file = new File(thumbPath);
        if (!file.exists()) {
            log.warn("Thumbnail file still not exists after path resolved: {}", thumbPath);
            response.setStatus(404);
            return;
        }
        streamFile(file, request, response, "image");
    }

    private void streamFile(File file, HttpServletRequest request, HttpServletResponse response, String mediaType) throws IOException {
        long fileLength = file.length();
        String range = request.getHeader("Range");

        if (range != null && range.startsWith("bytes=")) {
            String[] parts = range.substring(6).split("-");
            long start = Long.parseLong(parts[0]);
            long end = parts.length > 1 && !parts[1].isEmpty() ? Long.parseLong(parts[1]) : fileLength - 1;
            if (end >= fileLength) end = fileLength - 1;
            long contentLength = end - start + 1;

            response.setStatus(206);
            response.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + fileLength);
            response.setHeader("Accept-Ranges", "bytes");
            response.setContentType(getMediaType(file.getName(), mediaType));
            response.setHeader("Content-Length", String.valueOf(contentLength));

            try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
                raf.seek(start);
                byte[] buffer = new byte[8192];
                long remaining = contentLength;
                while (remaining > 0) {
                    int toRead = (int) Math.min(buffer.length, remaining);
                    int read = raf.read(buffer, 0, toRead);
                    if (read <= 0) break;
                    response.getOutputStream().write(buffer, 0, read);
                    remaining -= read;
                }
            }
        } else {
            response.setStatus(200);
            response.setContentType(getMediaType(file.getName(), mediaType));
            response.setHeader("Content-Length", String.valueOf(fileLength));
            response.setHeader("Accept-Ranges", "bytes");
            try (FileInputStream fis = new FileInputStream(file)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = fis.read(buffer)) != -1) {
                    response.getOutputStream().write(buffer, 0, read);
                }
            }
        }
    }

    private String getMediaType(String fileName, String type) {
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".avi")) return "video/x-msvideo";
        if (lower.endsWith(".mov")) return "video/quicktime";
        if (lower.endsWith(".mkv")) return "video/x-matroska";
        if (lower.endsWith(".flv")) return "video/x-flv";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        return "image".equals(type) ? "image/jpeg" : "video/mp4";
    }

    /** 修复标签封面：如果 coverVideoId 指向不存在的视频，自动找该标签下第一个有效视频 */
    private void fixStaleCover(Tag tag) {
        if (tag.getCoverVideoId() == null || tag.getCoverVideoId() == 0) return;
        Video coverVideo = videoMapper.findById(tag.getCoverVideoId());
        if (coverVideo != null) return; // 封面视频存在，无需修复

        log.info("Fixing stale cover for tag '{}': coverVideoId={} not found, searching...", tag.getName(), tag.getCoverVideoId());

        // 从该标签下的视频中找一个有效的
        List<Video> tagVideos = videoMapper.findByHashtag(tag.getName(), 0, 1);
        if (!tagVideos.isEmpty()) {
            Video first = tagVideos.get(0);
            // 确保有缩略图
            if (first.getThumbPath() == null || !new File(first.getThumbPath()).exists()) {
                File mediaFile = new File(first.getFilePath());
                if (mediaFile.exists()) {
                    String thumbPath = thumbnailService.generateSync(mediaFile, first.getTitle());
                    if (thumbPath != null) {
                        first.setThumbPath(thumbPath);
                        videoMapper.updateFilePath(first.getId(), first.getFilePath(), thumbPath, first.getFileSize());
                    }
                }
            }
            tag.setCoverVideoId(first.getId());
            tagMapper.updateCover(tag.getId(), first.getId(), null);
            log.info("Tag '{}' cover fixed to video {}", tag.getName(), first.getId());
        } else {
            // 标签下没有视频，清除封面
            tag.setCoverVideoId(null);
            tagMapper.updateCover(tag.getId(), null, null);
            log.info("Tag '{}' has no videos, cover cleared", tag.getName());
        }
    }
}
