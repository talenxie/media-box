package com.chat.model;

import java.util.Date;

public class Tag {
    private Long id;
    private String name;
    private Long coverVideoId;
    private String coverImagePath;
    private String description;
    private Date createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public Long getCoverVideoId() { return coverVideoId; }
    public void setCoverVideoId(Long coverVideoId) { this.coverVideoId = coverVideoId; }
    public String getCoverImagePath() { return coverImagePath; }
    public void setCoverImagePath(String coverImagePath) { this.coverImagePath = coverImagePath; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public Date getCreatedAt() { return createdAt; }
    public void setCreatedAt(Date createdAt) { this.createdAt = createdAt; }

    public String getCoverUrl() {
        if (coverVideoId != null) return "/api/stream/thumb/" + coverVideoId;
        return coverImagePath;
    }
}
