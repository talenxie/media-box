package com.chat.model;

import java.util.Date;

public class Danmaku {
    private Long id;
    private Long videoId;
    private Long userId;
    private String content;
    private Float timePoint;
    private String color;
    private Date createdAt;

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getVideoId() { return videoId; }
    public void setVideoId(Long videoId) { this.videoId = videoId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public Float getTimePoint() { return timePoint; }
    public void setTimePoint(Float timePoint) { this.timePoint = timePoint; }
    public String getColor() { return color; }
    public void setColor(String color) { this.color = color; }
    public Date getCreatedAt() { return createdAt; }
    public void setCreatedAt(Date createdAt) { this.createdAt = createdAt; }
}
