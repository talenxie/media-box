package com.chat.model;

import java.util.Date;

public class Video {
    private Long id;
    private String title;
    private String fileName;
    private String filePath;
    private String thumbPath;
    private String type;
    private String category;
    private String duration;
    private Long fileSize;
    private Integer width;
    private Integer height;
    private String hashtag;
    private String pendingHashtag;
    private String source;
    private Integer likeCount;
    private Integer viewCount;
    private Integer commentCount;
    private Integer hidden;
    private Integer nsfw;
    private String nsfwType;
    private Date createdAt;
    private Boolean liked;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getFileName() { return fileName; }
    public void setFileName(String fileName) { this.fileName = fileName; }
    public String getFilePath() { return filePath; }
    public void setFilePath(String filePath) { this.filePath = filePath; }
    public String getThumbPath() { return thumbPath; }
    public void setThumbPath(String thumbPath) { this.thumbPath = thumbPath; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public String getDuration() { return duration; }
    public void setDuration(String duration) { this.duration = duration; }
    public Long getFileSize() { return fileSize; }
    public void setFileSize(Long fileSize) { this.fileSize = fileSize; }
    public Integer getWidth() { return width; }
    public void setWidth(Integer width) { this.width = width; }
    public Integer getHeight() { return height; }
    public void setHeight(Integer height) { this.height = height; }
    public String getHashtag() { return hashtag; }
    public void setHashtag(String hashtag) { this.hashtag = hashtag; }
    public String getPendingHashtag() { return pendingHashtag; }
    public void setPendingHashtag(String pendingHashtag) { this.pendingHashtag = pendingHashtag; }
    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public Integer getLikeCount() { return likeCount; }
    public void setLikeCount(Integer likeCount) { this.likeCount = likeCount; }
    public Integer getViewCount() { return viewCount; }
    public void setViewCount(Integer viewCount) { this.viewCount = viewCount; }
    public Integer getCommentCount() { return commentCount; }
    public void setCommentCount(Integer commentCount) { this.commentCount = commentCount; }
    public Integer getHidden() { return hidden; }
    public void setHidden(Integer hidden) { this.hidden = hidden; }
    public Integer getNsfw() { return nsfw; }
    public void setNsfw(Integer nsfw) { this.nsfw = nsfw; }
    public String getNsfwType() { return nsfwType; }
    public void setNsfwType(String nsfwType) { this.nsfwType = nsfwType; }
    public Date getCreatedAt() { return createdAt; }
    public void setCreatedAt(Date createdAt) { this.createdAt = createdAt; }
    public Boolean getLiked() { return liked; }
    public void setLiked(Boolean liked) { this.liked = liked; }

    public String getUrl() {
        if (id == null) return null;
        return "/api/stream/video/" + id;
    }

    public String getThumbUrl() {
        if (id == null) return null;
        // 视频类型始终返回缩略图URL，首次访问时会按需生成
        if ("video".equals(type)) return "/api/stream/thumb/" + id;
        // 图片类型需要有缩略图路径
        if (thumbPath == null) return null;
        return "/api/stream/thumb/" + id;
    }
}
