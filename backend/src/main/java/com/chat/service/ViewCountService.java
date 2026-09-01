package com.chat.service;

import com.chat.mapper.VideoMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Set;

@Service
public class ViewCountService {

    private static final Logger log = LoggerFactory.getLogger(ViewCountService.class);
    private static final String VIEW_KEY_PREFIX = "view:";

    @Resource
    private VideoMapper videoMapper;

    @Resource(name = "stringRedisTemplate")
    private StringRedisTemplate redisTemplate;

    /**
     * 记录浏览量（Redis INCR，原子操作，立即返回）
     */
    public void incrementView(Long videoId) {
        redisTemplate.opsForValue().increment(VIEW_KEY_PREFIX + videoId, 1);
    }

    /**
     * 获取某个视频的待刷盘浏览量
     */
    public long getPendingViews(Long videoId) {
        String val = redisTemplate.opsForValue().get(VIEW_KEY_PREFIX + videoId);
        return val != null ? Long.parseLong(val) : 0;
    }

    /**
     * 定时批量刷盘：每30秒将 Redis 中的浏览量写入数据库
     */
    @Scheduled(fixedRate = 30000)
    public void flushToDb() {
        Set<String> keys = redisTemplate.keys(VIEW_KEY_PREFIX + "*");
        if (keys == null || keys.isEmpty()) return;

        int total = 0;
        int videoCount = 0;

        for (String key : keys) {
            try {
                // GETSET 原子操作：获取旧值并设置为0
                String val = redisTemplate.opsForValue().getAndSet(key, "0");
                if (val != null) {
                    long count = Long.parseLong(val);
                    if (count > 0) {
                        Long videoId = Long.parseLong(key.replace(VIEW_KEY_PREFIX, ""));
                        videoMapper.addViewCount(videoId, count);
                        total += count;
                        videoCount++;
                    }
                }
            } catch (Exception e) {
                log.error("Failed to flush view count for key {}: {}", key, e.getMessage());
            }
        }

        if (total > 0) {
            log.info("Flushed view counts from Redis: {} videos, {} total views", videoCount, total);
        }
    }
}
