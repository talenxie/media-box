package com.chat.service;

import com.chat.mapper.TagMapper;
import com.chat.mapper.VideoMapper;
import com.chat.model.Tag;
import com.chat.model.Video;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import javax.annotation.Resource;
import java.io.File;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public class ThumbnailService {

    private static final Logger log = LoggerFactory.getLogger(ThumbnailService.class);

    @Resource
    private VideoMapper videoMapper;

    @Resource
    private TagMapper tagMapper;

    @Value("${chat.thumb-dir:./thumbnails}")
    private String thumbDir;

    @Value("${chat.thumb-max-mb:500}")
    private int thumbMaxMb;

    @Value("${chat.thumb-queue-size:200}")
    private int thumbQueueSize;

    @Value("${chat.ffmpeg-path:}")
    private String ffmpegPath;

    private final BlockingQueue<Video> generateQueue = new LinkedBlockingQueue<>(500);
    private ExecutorService worker;
    private final AtomicBoolean running = new AtomicBoolean(true);

    @PostConstruct
    public void init() {
        worker = Executors.newFixedThreadPool(2, r -> {
            Thread t = new Thread(r, "thumb-worker");
            t.setDaemon(true);
            return t;
        });
        worker.submit(this::run);
        // 延迟扫描缺失的缩略图和失效的标签封面，等待数据库就绪
        worker.submit(() -> {
            try { Thread.sleep(8000); } catch (InterruptedException e) { return; }
            scanMissingThumbnails();
            fixStaleTagCovers();
        });
        log.info("ThumbnailService started, max={}MB, queue={}", thumbMaxMb, thumbQueueSize);
    }

    /** 启动时扫描所有无缩略图的视频，加入队列（图片不加入，按需懒加载） */
    public void scanMissingThumbnails() {
        try {
            List<Video> allVideos = videoMapper.findAllNoLimit();
            int enqueued = 0;
            for (Video v : allVideos) {
                // 图片跳过，由streamThumb按需生成
                if ("image".equals(v.getType())) continue;
                // 视频：thumbPath为空或文件不存在时加入队列
                String tp = v.getThumbPath();
                if (tp != null && !tp.isEmpty() && new File(tp).exists()) continue;
                if (generateQueue.offer(v)) enqueued++;
            }
            if (enqueued > 0) {
                log.info("Startup scan: {} videos need thumbnails, queued for generation", enqueued);
            } else {
                log.info("Startup scan: all video thumbnails up to date");
            }
        } catch (Exception e) {
            log.error("Startup thumbnail scan failed: {}", e.getMessage());
        }
    }

    /** 判断视频/图片是否需要生成缩略图 */
    private boolean needsThumbnail(Video v) {
        String tp = v.getThumbPath();
        // 没有thumbPath
        if (tp == null || tp.isEmpty()) return true;
        // thumbPath指向的文件不存在
        if (!new File(tp).exists()) return true;
        // 图片的thumbPath指向原图（需要生成缩略图）
        if (v.getFilePath() != null && tp.equals(v.getFilePath())) return true;
        return false;
    }

    /** 启动时修复所有指向不存在视频的标签封面 */
    private void fixStaleTagCovers() {
        try {
            List<Tag> allTags = tagMapper.findAll();
            int fixed = 0;
            for (Tag tag : allTags) {
                if (tag.getCoverVideoId() == null || tag.getCoverVideoId() == 0) continue;
                Video coverVideo = videoMapper.findById(tag.getCoverVideoId());
                if (coverVideo != null) continue;

                log.info("Fixing stale tag cover: '{}' -> video {} not found", tag.getName(), tag.getCoverVideoId());
                List<Video> tagVideos = videoMapper.findByHashtag(tag.getName(), 0, 1);
                if (!tagVideos.isEmpty()) {
                    Video first = tagVideos.get(0);
                    tagMapper.updateCover(tag.getId(), first.getId(), null);
                    log.info("Tag '{}' cover updated to video {}", tag.getName(), first.getId());
                } else {
                    tagMapper.updateCover(tag.getId(), null, null);
                    log.info("Tag '{}' has no videos, cover cleared", tag.getName());
                }
                fixed++;
            }
            if (fixed > 0) log.info("Fixed {} stale tag covers", fixed);
            else log.info("All tag covers are valid");
        } catch (Exception e) {
            log.error("Stale tag cover fix failed: {}", e.getMessage());
        }
    }

    @PreDestroy
    public void shutdown() {
        running.set(false);
        if (worker != null) worker.shutdownNow();
    }

    /** 扫描时调用：把视频/图片加入后台生成队列，不阻塞 */
    public void enqueue(Video video) {
        if (video == null || video.getId() == null) return;
        if (!needsThumbnail(video)) return;
        boolean offered = generateQueue.offer(video);
        if (offered) {
            log.debug("Enqueued thumbnail for: {} (queue size: {})", video.getTitle(), generateQueue.size());
        } else {
            log.warn("Thumbnail queue full, dropping: {}", video.getTitle());
        }
    }

    /** 按需生成：如果缩略图不存在，同步生成并返回路径（用于懒加载 fallback） */
    public String generateSync(File videoFile, String title) {
        log.info("generateSync called: file={}, exists={}", videoFile.getAbsolutePath(), videoFile.exists());
        String result = doGenerate(videoFile, title);
        if (result == null) {
            log.warn("generateSync FAILED for: {} (ffmpeg={})", videoFile.getName(), findFfmpeg());
        } else {
            log.info("generateSync OK: {} -> {}", videoFile.getName(), result);
        }
        return result;
    }

    /** 检查缩略图是否存在 */
    public boolean hasThumbnail(Video video) {
        return !needsThumbnail(video);
    }

    /** 清理孤立缩略图（视频已删除但缩略图还在） */
    public int cleanOrphans() {
        File dir = new File(thumbDir);
        if (!dir.exists()) return 0;

        // 收集所有视频的缩略图路径
        Set<String> validPaths = new HashSet<>();
        List<Video> allVideos = videoMapper.findAllNoLimit();
        for (Video v : allVideos) {
            if (v.getThumbPath() != null) validPaths.add(new File(v.getThumbPath()).getAbsolutePath());
        }

        int deleted = 0;
        File[] files = dir.listFiles((d, name) -> name.endsWith("_thumb.jpg"));
        if (files != null) {
            for (File f : files) {
                if (!validPaths.contains(f.getAbsolutePath())) {
                    if (f.delete()) deleted++;
                }
            }
        }
        if (deleted > 0) log.info("Cleaned {} orphan thumbnails", deleted);
        return deleted;
    }

    /** 清理超出容量限制的缩略图（LRU：删最久没访问的） */
    public int enforceLimit() {
        File dir = new File(thumbDir);
        if (!dir.exists()) return 0;

        File[] files = dir.listFiles((d, name) -> name.endsWith("_thumb.jpg"));
        if (files == null) return 0;

        long totalSize = 0;
        for (File f : files) totalSize += f.length();

        long maxBytes = (long) thumbMaxMb * 1024 * 1024;
        if (totalSize <= maxBytes) return 0;

        // 按最后访问时间排序（最久没用的排前面）
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));

        int deleted = 0;
        for (File f : files) {
            if (totalSize <= maxBytes) break;
            long size = f.length();
            if (f.delete()) {
                totalSize -= size;
                deleted++;
            }
        }
        if (deleted > 0) log.info("Evicted {} thumbnails, freed space to {}MB", deleted, totalSize / 1024 / 1024);
        return deleted;
    }

    /** 获取缩略图目录统计 */
    public Map<String, Object> getStats() {
        File dir = new File(thumbDir);
        Map<String, Object> stats = new HashMap<>();
        stats.put("maxMb", thumbMaxMb);
        stats.put("queueSize", generateQueue.size());
        if (!dir.exists()) {
            stats.put("count", 0);
            stats.put("totalMb", 0);
            return stats;
        }
        File[] files = dir.listFiles((d, name) -> name.endsWith("_thumb.jpg"));
        long totalSize = 0;
        if (files != null) {
            stats.put("count", files.length);
            for (File f : files) totalSize += f.length();
        }
        stats.put("totalMb", totalSize / 1024 / 1024);
        return stats;
    }

    // === 内部实现 ===

    private void run() {
        String ffmpegPath = findFfmpeg();
        if (ffmpegPath == null) {
            log.warn("FFmpeg not found! Thumbnail generation disabled. Place ffmpeg.exe in tools/ directory.");
            return;
        }
        log.info("Thumbnail worker started, ffmpeg={}", ffmpegPath);

        // 等待数据库就绪
        try { Thread.sleep(5000); } catch (InterruptedException e) { return; }

        while (running.get()) {
            try {
                Video video = generateQueue.poll(2, TimeUnit.SECONDS);
                if (video == null) continue;

                // 检查是否已生成（可能手动生成过）
                if (hasThumbnail(video)) {
                    log.debug("Thumbnail already exists for: {}", video.getTitle());
                    continue;
                }

                File videoFile = new File(video.getFilePath());
                if (!videoFile.exists()) {
                    log.debug("Video file not found: {}", video.getFilePath());
                    continue;
                }

                log.info("Generating thumbnail for: {}", video.getTitle());
                String thumbPath = doGenerate(videoFile, video.getTitle());
                if (thumbPath != null) {
                    videoMapper.updateFilePath(video.getId(), video.getFilePath(), thumbPath, video.getFileSize());
                    video.setThumbPath(thumbPath);
                    log.info("Thumbnail generated: {} -> {}", video.getTitle(), thumbPath);
                } else {
                    log.warn("Thumbnail generation failed for: {}", video.getTitle());
                }

                // 每生成10个检查一次容量
                if (generateQueue.size() % 10 == 0) enforceLimit();

                // 生成后暂停500ms，降低CPU/IO占用
                try { Thread.sleep(500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                log.error("Thumbnail worker error: {}", e.getMessage(), e);
            }
        }
        log.info("Thumbnail worker stopped");
    }

    // 候选时间点（秒）：开头跳过黑帧的常见位置
    private static final int[] CANDIDATE_SECONDS = {1, 3, 10, 30, 60};
    // 亮度阈值：低于此值认为是黑帧（0-255，16是安全阈值）
    private static final int BLACK_THRESHOLD = 16;

    /** 判断是否为图片文件 */
    private boolean isImageFile(File file) {
        String name = file.getName().toLowerCase();
        return name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") 
            || name.endsWith(".gif") || name.endsWith(".webp") || name.endsWith(".bmp");
    }

    /** 用ffmpeg生成图片缩略图 */
    private String generateImageThumbnail(String ffmpegPath, File imageFile) {
        File thumbDirFile = new File(thumbDir);
        if (!thumbDirFile.exists()) thumbDirFile.mkdirs();
        String safeName = imageFile.getName().replaceAll("[^a-zA-Z0-9._\\-]", "_");
        String thumbName = safeName + "_thumb.jpg";
        File thumbFile = new File(thumbDirFile, thumbName);
        if (thumbFile.exists()) return thumbFile.getAbsolutePath();
        try {
            log.info("Generating image thumbnail: {} -> {}", imageFile.getName(), thumbFile.getAbsolutePath());
            ProcessBuilder pb = new ProcessBuilder(
                ffmpegPath, "-y", "-i", imageFile.getAbsolutePath(),
                "-vf", "scale='min(480,iw)':-1", "-q:v", "5",
                thumbFile.getAbsolutePath()
            );
            pb.redirectErrorStream(true);
            Process p = pb.start();
            boolean finished = p.waitFor(30, TimeUnit.SECONDS);
            if (!finished) {
                log.warn("Image thumbnail generation timeout: {}", imageFile.getName());
                p.destroyForcibly();
                return null;
            }
            if (p.exitValue() != 0) {
                log.warn("Image thumbnail ffmpeg failed: exitCode={}, file={}", p.exitValue(), imageFile.getName());
            }
        } catch (Exception e) {
            log.warn("Image thumbnail generation failed: {} - {}", imageFile.getName(), e.getMessage());
            return null;
        }
        if (!thumbFile.exists()) {
            log.warn("Image thumbnail file not created: {} (input exists={})", thumbFile.getAbsolutePath(), imageFile.exists());
        }
        return thumbFile.exists() ? thumbFile.getAbsolutePath() : null;
    }

    private String doGenerate(File videoFile, String title) {
        String ffmpegPath = findFfmpeg();
        if (ffmpegPath == null) {
            log.warn("doGenerate: ffmpeg not found, cannot generate thumbnail for: {}", videoFile.getName());
            return null;
        }

        // 图片文件用ffmpeg缩放生成缩略图
        if (isImageFile(videoFile)) {
            return generateImageThumbnail(ffmpegPath, videoFile);
        }

        // 检测是否有视频流（纯音频文件跳过）
        if (!hasVideoStream(ffmpegPath, videoFile)) {
            log.debug("Skipping audio-only file: {}", videoFile.getName());
            return null;
        }

        File thumbDirFile = new File(thumbDir);
        if (!thumbDirFile.exists()) thumbDirFile.mkdirs();

        String safeName = videoFile.getName().replaceAll("[^a-zA-Z0-9._\\-]", "_");
        String thumbName = safeName + "_thumb.jpg";
        File thumbFile = new File(thumbDirFile, thumbName);

        if (thumbFile.exists()) return thumbFile.getAbsolutePath();

        // 1. 先获取视频时长
        int durationSec = getVideoDuration(ffmpegPath, videoFile);

        // 2. 构建候选时间点列表
        List<int[]> candidates = new ArrayList<>();
        for (int sec : CANDIDATE_SECONDS) {
            if (durationSec <= 0 || sec < durationSec) {
                candidates.add(new int[]{sec, 0}); // {秒, 0=固定时间}
            }
        }
        // 加上百分比位置（10%和25%）
        if (durationSec > 30) {
            candidates.add(new int[]{(int)(durationSec * 0.1), 1}); // 10%
            candidates.add(new int[]{(int)(durationSec * 0.25), 1}); // 25%
        }

        // 3. 逐个尝试，找到非黑帧
        for (int[] candidate : candidates) {
            int sec = candidate[0];
            String ts = String.format("%02d:%02d:%02d", sec / 3600, (sec % 3600) / 60, sec % 60);

            File candidateFile = new File(thumbDirFile, safeName + "_candidate.jpg");

            // 提取帧
            boolean extracted = extractFrame(ffmpegPath, videoFile, ts, candidateFile);
            if (!extracted || !candidateFile.exists()) continue;

            // 检测亮度
            int brightness = detectBrightness(ffmpegPath, candidateFile);

            if (brightness >= BLACK_THRESHOLD) {
                // 非黑帧，用这个！
                if (candidateFile.renameTo(thumbFile)) {
                    log.info("Thumbnail generated at {}s (brightness={}): {}", sec, brightness, videoFile.getName());
                    return thumbFile.getAbsolutePath();
                }
            } else {
                log.debug("Black frame detected at {}s (brightness={}), trying next: {}", sec, brightness, videoFile.getName());
                candidateFile.delete();
            }
        }

        // 4. 所有候选都是黑帧，用最后一个候选（即使是黑的也比没有好）
        File lastCandidate = new File(thumbDirFile, safeName + "_candidate.jpg");
        if (lastCandidate.exists()) {
            if (lastCandidate.renameTo(thumbFile)) {
                log.info("Thumbnail generated (fallback, all candidates were dark): {}", videoFile.getName());
                return thumbFile.getAbsolutePath();
            }
        }

        // 5. 兜底：直接用第1秒
        boolean fallback = extractFrame(ffmpegPath, videoFile, "00:00:01", thumbFile);
        if (fallback && thumbFile.exists()) {
            log.info("Thumbnail generated (hard fallback at 3s): {}", videoFile.getName());
            return thumbFile.getAbsolutePath();
        }

        return null;
    }

    /** 检测文件是否有视频流 */
    private boolean hasVideoStream(String ffmpegPath, File videoFile) {
        try {
            ProcessBuilder pb = new ProcessBuilder(ffmpegPath, "-i", videoFile.getAbsolutePath());
            pb.redirectErrorStream(true);
            Process p = pb.start();
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream()));
            String line;
            boolean hasVideo = false;
            while ((line = reader.readLine()) != null) {
                if (line.contains("Video:")) { hasVideo = true; }
                // 损坏文件检测
                if (line.contains("moov atom not found") || line.contains("Invalid data found") || line.contains("Error opening input")) {
                    p.waitFor();
                    return false;
                }
            }
            p.waitFor();
            return hasVideo;
        } catch (Exception e) {
            return false; // 检测失败时跳过
        }
    }

    /** 获取视频时长（秒） */
    private int getVideoDuration(String ffmpegPath, File videoFile) {
        try {
            ProcessBuilder pb = new ProcessBuilder(
                ffmpegPath, "-i", videoFile.getAbsolutePath()
            );
            pb.redirectErrorStream(true);
            Process p = pb.start();
            java.io.BufferedReader reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(p.getInputStream()));
            String line;
            int duration = 0;
            while ((line = reader.readLine()) != null) {
                if (line.contains("Duration:")) {
                    // Duration: 00:05:30.12
                    int idx = line.indexOf("Duration:") + 10;
                    String durStr = line.substring(idx, idx + 8).trim();
                    String[] parts = durStr.split(":");
                    duration = Integer.parseInt(parts[0]) * 3600
                             + Integer.parseInt(parts[1]) * 60
                             + (int) Double.parseDouble(parts[2]);
                    break;
                }
            }
            reader.close();
            p.waitFor(5, TimeUnit.SECONDS);
            p.destroyForcibly();
            return duration;
        } catch (Exception e) {
            return 0;
        }
    }

    /** 提取指定时间点的帧 */
    private boolean extractFrame(String ffmpegPath, File videoFile, String timestamp, File outputFile) {
        try {
            ProcessBuilder pb = new ProcessBuilder(
                ffmpegPath,
                "-threads", "1",
                "-ss", timestamp,
                "-i", videoFile.getAbsolutePath(),
                "-frames:v", "1",
                "-q:v", "5",
                "-strict", "unofficial",
                "-y", outputFile.getAbsolutePath()
            );
            pb.redirectErrorStream(true);
            Process p = pb.start();
            drainOutput(p);
            boolean finished = p.waitFor(15, TimeUnit.SECONDS);
            if (!finished) {
                log.warn("extractFrame timeout at {}s for: {}", timestamp, videoFile.getName());
                p.destroyForcibly();
                return false;
            }
            boolean success = p.exitValue() == 0 && outputFile.exists();
            if (!success) {
                log.warn("extractFrame failed at {}s: exitCode={}, outputExists={}", timestamp, p.exitValue(), outputFile.exists());
            }
            return success;
        } catch (Exception e) {
            log.warn("extractFrame exception: {}", e.getMessage());
            return false;
        }
    }

    /** 检测图片平均亮度（0-255） */
    private int detectBrightness(String ffmpegPath, File imageFile) {
        try {
            // 用 signalstats 检测亮度，输出 YAVG（亮度平均值）
            ProcessBuilder pb = new ProcessBuilder(
                ffmpegPath,
                "-i", imageFile.getAbsolutePath(),
                "-vf", "signalstats",
                "-f", "null", "-"
            );
            pb.redirectErrorStream(true);
            Process p = pb.start();
            java.io.BufferedReader reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(p.getInputStream()));
            String line;
            int brightness = -1;
            while ((line = reader.readLine()) != null) {
                // 输出格式: ... YAVG:123.45 ...
                if (line.contains("YAVG:")) {
                    int idx = line.indexOf("YAVG:") + 5;
                    String val = "";
                    for (int i = idx; i < line.length(); i++) {
                        char c = line.charAt(i);
                        if (c >= '0' && c <= '9' || c == '.') val += c;
                        else break;
                    }
                    if (!val.isEmpty()) {
                        brightness = (int) Double.parseDouble(val);
                    }
                    break;
                }
            }
            reader.close();
            p.waitFor(5, TimeUnit.SECONDS);
            p.destroyForcibly();
            return brightness >= 0 ? brightness : BLACK_THRESHOLD + 1; // 检测失败默认非黑
        } catch (Exception e) {
            return BLACK_THRESHOLD + 1; // 检测失败默认非黑
        }
    }

    private void drainOutput(Process p) {
        Thread t = new Thread(() -> {
            try {
                java.io.InputStream is = p.getInputStream();
                while (is.read() != -1) {}
                is.close();
            } catch (Exception ignored) {}
        }, "thumb-drainer");
        t.setDaemon(true);
        t.start();
    }

    private String findFfmpeg() {
        // 0. 配置文件指定的路径
        if (ffmpegPath != null && !ffmpegPath.isEmpty() && new File(ffmpegPath).exists()) {
            return new File(ffmpegPath).getAbsolutePath();
        }

        // 1. 项目 tools 目录（相对路径）
        String localPath = "tools" + File.separator + "ffmpeg.exe";
        if (new File(localPath).exists()) return localPath;

        // 2. jar 包同级的 tools 目录
        try {
            String jarDir = new File(getClass().getProtectionDomain()
                    .getCodeSource().getLocation().toURI()).getParentFile().getAbsolutePath();
            String jarLocalPath = jarDir + File.separator + "tools" + File.separator + "ffmpeg.exe";
            if (new File(jarLocalPath).exists()) return jarLocalPath;
        } catch (Exception ignored) {}

        // 3. 系统 PATH
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

        log.warn("findFfmpeg: ffmpeg not found! config={}, localPath={}, cwd={}",
                ffmpegPath, localPath, new File(".").getAbsolutePath());
        return null;
    }
}
