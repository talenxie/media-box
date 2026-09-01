package com.chat.mapper;

import com.chat.model.MediaFolder;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface MediaFolderMapper {
    List<MediaFolder> findAll();
    MediaFolder findById(Long id);
    int insert(MediaFolder folder);
    int deleteById(Long id);
}
