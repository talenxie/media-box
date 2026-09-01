package com.chat.mapper;

import com.chat.model.Tag;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TagMapper {
    Tag findByName(@Param("name") String name);
    List<Tag> findByNameLike(@Param("keyword") String keyword);
    List<Tag> findAll();
    int insert(Tag tag);
    int updateCover(@Param("id") Long id, @Param("coverVideoId") Long coverVideoId, @Param("coverImagePath") String coverImagePath);
    int updateDescription(@Param("id") Long id, @Param("description") String description);
    int deleteByName(@Param("name") String name);
    int rename(@Param("oldName") String oldName, @Param("newName") String newName);
}
